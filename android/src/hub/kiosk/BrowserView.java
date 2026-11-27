package hub.kiosk;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Outline;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.PersistableBundle;
import android.util.Base64;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The Browser app's pages: one native WebView per browser tab, laid over the Claude Home page exactly where
 * the Browser app's content area is. Most sites refuse to be framed, so an iframe can't do this.
 *
 * The page draws all the chrome (tabs, address bar, menus, sheets) and drives this through Bridge.browser*().
 * What happens in a tab goes back to the page as window.hubBrowser({tab, type, ...}); see device.ts for the
 * event types. Global events (downloads, permission asks, incoming links) have tab "".
 *
 * The tab views get no JavaScript bridge; they are ordinary web pages. Only http(s) loads; intent:, market:,
 * file: and everything else is refused; plain http to anything but the PC is upgraded to https.
 * No file or content access, no third-party cookies, no geolocation, camera or mic until the page's
 * Allow sheet says yes (answerPermission), and then only the Android permission the site needs.
 *
 * Private tabs: no DOM storage, databases or disk cache for that view, no history (the page skips it), and the
 * cookies its sites set are removed when the tab closes. Android's WebView keeps ONE cookie jar for the app, so
 * a private tab cannot be fully sealed off from the other tabs' cookies; see the report.
 *
 * Downloads: BrowserDownloads (DownloadManager, data: images through MediaStore).
 * Uploads: the page's sheet asks for files, the camera or a Claude Home photo (chooseFile).
 * Google sign-in: X-Requested-With is removed from every tab (WebSettingsCompat allow-list, empty).
 *
 * MainActivity creates one with its root layout and the main WebView, and asks goBack() on Android's back.
 * Every method here must run on the UI thread; the Bridge posts to it.
 */
public class BrowserView {
  static final int REQ_PERMS = 61;
  /** Sizes the Browser will open in its own viewer; anything bigger is only named, not shown. */
  private static final long VIEW_IMAGE_MAX = 5L * 1024 * 1024, VIEW_TEXT_MAX = 256L * 1024;
  /** A JavaScript alert, confirm or prompt from a tab: the JsResult to answer, and the tab it came from. */
  private static final class Dialog {
    final String tab; final JsResult result;
    Dialog(String tab, JsResult result) { this.tab = tab; this.result = result; }
  }
  private static BrowserView instance;
  /** The one made by MainActivity (null before). */
  static BrowserView get() { return instance; }

  /** A link from another app (VIEW intent), waiting for the page to take it: see takeIncoming(). */
  private static volatile String incoming = "";
  /** True when the intent is a web link; remembers it for the page. */
  static boolean fromIntent(Intent i) {
    if (i == null || !Intent.ACTION_VIEW.equals(i.getAction()) || i.getData() == null) return false;
    String s = i.getScheme();
    if (!"http".equalsIgnoreCase(s) && !"https".equalsIgnoreCase(s)) return false;
    incoming = i.getData().toString();
    return true;
  }
  /** The link waiting for the Browser app, once ("" when none). */
  static String takeIncoming() { String s = incoming; incoming = ""; return s; }

  private static final class Tab {
    final String id;
    WebView view;
    boolean priv, desktop;
    float zoom = 1f;                       // relative to the page's fitted scale; 1 = fit to width
    final Set<String> hosts = new HashSet<>();
    Tab(String id) { this.id = id; }
  }

  private static final class Pending {
    PermissionRequest req;
    GeolocationPermissions.Callback geo;
    String origin;
    List<String> kinds = new ArrayList<>();
  }

  private final MainActivity act;
  private final FrameLayout root;
  private final WebView main;
  private final Handler ui = new Handler(Looper.getMainLooper());
  private final Map<String, Tab> tabs = new LinkedHashMap<>();
  final BrowserDownloads downloads;
  private String shown = null;          // the tab on screen (when not covered)
  private boolean covered = false;
  private int x, y, w, h;
  private String userAgent;
  private int seq = 0;

  // one file chooser at a time (a page asks; the page's sheet answers through chooseFile). The sheet offers only
  // ClaudeOS's own photos and camera, so no Android picker is ever started.
  private ValueCallback<Uri[]> chooserCb;
  private String chooserTab = "";
  private boolean chooserMulti = false;
  private String chooserAccept = "";

  // JavaScript dialogs of the tabs, answered by the page's sheets (answerDialog)
  private final Map<String, Dialog> dialogs = new HashMap<>();
  private int dialogSeq = 0;

  // site permissions: the page answers (answerPermission); Android's runtime permissions are asked once
  private final Map<String, Pending> asking = new HashMap<>();
  private Pending waitingRuntime;

  BrowserView(MainActivity act, FrameLayout root, WebView main) {
    this.act = act; this.root = root; this.main = main;
    this.downloads = new BrowserDownloads(this, act);
    instance = this;
  }

  /** Run on the UI thread (Bridge calls arrive on a binder thread). */
  void post(Runnable r) { ui.post(() -> { try { r.run(); } catch (Exception e) { android.util.Log.w("HubBrowser", e); } }); }

  // ---------- what the page asks ----------

  void show(String id, String url, int x, int y, int w, int h) {
    this.x = x; this.y = y; this.w = Math.max(1, w); this.h = Math.max(1, h);
    boolean fresh = tabs.get(id) == null || tabs.get(id).view == null;
    WebView v = view(id);
    shown = id;
    if (fresh && url != null && !url.isEmpty()) load(id, v, url);
    layout();
  }

  void hide() { shown = null; layout(); }

  void cover(boolean on) { covered = on; layout(); }

  void navigate(String id, String url) { load(id, view(id), url); layout(); }

  void back(String id) { Tab t = tabs.get(id); if (t != null && t.view != null && t.view.canGoBack()) t.view.goBack(); }
  void forward(String id) { Tab t = tabs.get(id); if (t != null && t.view != null && t.view.canGoForward()) t.view.goForward(); }
  void reload(String id) { Tab t = tabs.get(id); if (t != null && t.view != null) t.view.reload(); }
  void stop(String id) {
    Tab t = tabs.get(id);
    if (t == null || t.view == null) return;
    t.view.stopLoading();
    emit(id, "progress", "progress", 100, "loading", false, "canGoBack", t.view.canGoBack(), "canGoForward", t.view.canGoForward());
  }

  /** Makes the tab's settings (private, desktop) before its view exists; later only desktop changes apply. */
  void configure(String id, boolean priv, boolean desktop) {
    Tab t = tab(id);
    if (t.view == null) { t.priv = priv; t.desktop = desktop; }
  }

  void close(String id) {
    Tab t = tabs.remove(id);
    if (id.equals(shown)) shown = null;
    if (id.equals(chooserTab)) finishChooser(null);
    for (String d : new ArrayList<>(dialogs.keySet())) if (id.equals(dialogs.get(d).tab)) answerDialog(d, false, "");
    if (t == null || t.view == null) return;
    root.removeView(t.view);
    t.view.stopLoading();
    if (t.priv) clearCookiesFor(t.hosts);
    t.view.destroy();
  }

  /** Cookies, storage and cache of visited sites. Claude Home's own storage (the PC's origin) is kept. */
  void clearData() {
    CookieManager.getInstance().removeAllCookies(null);
    CookieManager.getInstance().flush();
    final String keep = act.serverOrigin();
    WebStorage.getInstance().getOrigins(value -> {
      if (!(value instanceof Map)) return;
      for (Object o : ((Map<?, ?>) value).values()) {
        if (!(o instanceof WebStorage.Origin)) continue;
        String origin = ((WebStorage.Origin) o).getOrigin();
        if (origin != null && !origin.startsWith(keep)) WebStorage.getInstance().deleteOrigin(origin);
      }
    });
    for (Tab t : tabs.values()) if (t.view != null) { t.view.clearCache(true); t.view.clearFormData(); }
    if (tabs.isEmpty()) { WebView t = new WebView(act); t.clearCache(true); t.destroy(); }
    android.webkit.WebViewDatabase.getInstance(act).clearHttpAuthUsernamePassword();
  }

  /** Android's back: go back in the browser first, while a page is on screen. */
  boolean goBack() {
    if (shown == null || covered) return false;
    Tab t = tabs.get(shown);
    if (t == null || t.view == null || !t.view.canGoBack()) return false;
    t.view.goBack();
    return true;
  }

  /** Bring every page down (the activity is going away). */
  void destroyAll() {
    for (Tab t : tabs.values()) if (t.view != null) { root.removeView(t.view); t.view.destroy(); }
    tabs.clear();
    shown = null;
  }

  // ---------- find, zoom, desktop, reader, snapshot, sharing ----------

  void find(String id, String q) {
    Tab t = tabs.get(id);
    if (t == null || t.view == null) return;
    if (q == null || q.isEmpty()) { t.view.clearMatches(); emit(id, "find", "count", 0, "index", 0, "done", true); return; }
    t.view.findAllAsync(q);
  }

  void findStep(String id, boolean forward) { Tab t = tabs.get(id); if (t != null && t.view != null) t.view.findNext(forward); }

  void findClose(String id) { Tab t = tabs.get(id); if (t != null && t.view != null) t.view.clearMatches(); }

  /** step: +1 bigger, -1 smaller, 0 back to fitted. */
  void zoom(String id, int step) {
    Tab t = tabs.get(id);
    if (t == null || t.view == null) return;
    float target = step > 0 ? t.zoom * 1.25f : step < 0 ? t.zoom * 0.8f : 1f;
    target = Math.max(0.5f, Math.min(4f, target));
    t.view.zoomBy(target / t.zoom);
    t.zoom = target;
    emit(id, "zoom", "percent", Math.round(t.zoom * 100));
  }

  void desktop(String id, boolean on) {
    Tab t = tab(id);
    t.desktop = on;
    if (t.view == null) return;
    applyAgent(t);
    t.view.reload();
  }

  /** Reader view: the page's article as plain blocks (see READER_JS); the page draws it. */
  void reader(String id) {
    Tab t = tabs.get(id);
    if (t == null || t.view == null) { emit(id, "reader", "article", ""); return; }
    t.view.evaluateJavascript(READER_JS, raw -> {
      String json = "";
      try { json = new JSONArray("[" + raw + "]").optString(0, ""); } catch (Exception ignored) { }
      emit(id, "reader", "article", json.equals("null") ? "" : json);
    });
  }

  /** A small picture of the tab for the tab overview (the page keeps it). */
  void snapshot(String id) {
    Tab t = tabs.get(id);
    if (t == null || t.view == null || t.view.getWidth() < 4) return;
    try {
      int sw = Math.max(1, t.view.getWidth() / 4), sh = Math.max(1, t.view.getHeight() / 4);
      Bitmap b = Bitmap.createBitmap(sw, sh, Bitmap.Config.RGB_565);
      Canvas c = new Canvas(b);
      c.drawColor(Color.WHITE);
      c.scale(1f / 4, 1f / 4);
      t.view.draw(c);
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      b.compress(Bitmap.CompressFormat.JPEG, 70, out);
      emit(id, "thumb", "image", "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
    } catch (Exception e) { android.util.Log.w("HubBrowser", "snapshot", e); }
  }

  // ---------- Claude control: read, click, type, screenshot ----------
  // Asked by the Claude page (Bridge.browserReadPage and the rest). Each call carries a request id; the answer comes back
  // as window.hubBrowser({tab, type: 'claude', req, op, ok, data}). A ref is the data-hub-ref mark READ_PAGE_JS puts on
  // a link or field; anything else is refused. Password fields are never read back.
  private static final java.util.regex.Pattern REF_OK = java.util.regex.Pattern.compile("r\\d{1,7}");
  private static final int TYPE_MAX = 4000;

  private static final String READ_PAGE_JS =
      "(function(){var seen=window.__hubRefs||0;"
    + "function ref(el){var r=el.getAttribute('data-hub-ref');if(!r){seen++;window.__hubRefs=seen;r='r'+seen;el.setAttribute('data-hub-ref',r);}return r;}"
    + "function vis(el){return !!(el.offsetWidth||el.offsetHeight||el.getClientRects().length);}"
    + "var links=[],fields=[];"
    + "var as=document.querySelectorAll('a[href]');for(var i=0;i<as.length&&links.length<200;i++){var a=as[i];if(!vis(a))continue;"
    + "var t=(a.innerText||a.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ').slice(0,120);links.push({ref:ref(a),text:t,href:a.href});}"
    + "var fs=document.querySelectorAll('input:not([type=hidden]),textarea,select,[contenteditable=\"true\"]');"
    + "for(var j=0;j<fs.length&&fields.length<100;j++){var f=fs[j];if(!vis(f))continue;"
    + "var lb=f.getAttribute('aria-label')||f.getAttribute('placeholder')||(f.labels&&f.labels[0]&&f.labels[0].innerText)||f.name||'';"
    + "fields.push({ref:ref(f),label:String(lb).trim().slice(0,120),type:f.type||f.tagName.toLowerCase(),"
    + "value:(f.type==='password')?'':String(f.value||'').slice(0,200)});}"
    + "return JSON.stringify({url:location.href,title:document.title,text:((document.body&&document.body.innerText)||'').slice(0,20000),links:links,fields:fields});})()";

  /** The page's own answer to a Claude call, in the same shape as the other browser events. */
  private void claudeAnswer(String id, String req, String op, boolean ok, String data) {
    emit(id, "claude", "req", req, "op", op, "ok", ok, "data", data);
  }

  /** A JavaScript string result (evaluateJavascript gives it JSON-quoted): decoded, "" for null. */
  private static String decodeJs(String raw) {
    try { String s = new JSONArray("[" + raw + "]").optString(0, ""); return "null".equals(s) ? "" : s; }
    catch (Exception e) { return ""; }
  }

  void readPage(String id, String req) {
    Tab t = tabs.get(id);
    if (t == null || t.view == null) { claudeAnswer(id, req, "read", false, "no_tab"); return; }
    t.view.evaluateJavascript(READ_PAGE_JS, raw -> claudeAnswer(id, req, "read", true, decodeJs(raw)));
  }

  void click(String id, String req, String ref) {
    Tab t = tabs.get(id);
    if (t == null || t.view == null) { claudeAnswer(id, req, "click", false, "no_tab"); return; }
    if (ref == null || !REF_OK.matcher(ref).matches()) { claudeAnswer(id, req, "click", false, "bad_ref"); return; }
    String js = "(function(r){var el=document.querySelector('[data-hub-ref=\"'+r+'\"]');if(!el)return 'missing';"
        + "el.scrollIntoView({block:'center'});el.click();return 'ok';})(" + JSONObject.quote(ref) + ")";
    t.view.evaluateJavascript(js, raw -> {
      String out = decodeJs(raw);
      claudeAnswer(id, req, "click", "ok".equals(out), out);
    });
  }

  void type(String id, String req, String ref, String text) {
    Tab t = tabs.get(id);
    if (t == null || t.view == null) { claudeAnswer(id, req, "type", false, "no_tab"); return; }
    if (ref == null || !REF_OK.matcher(ref).matches()) { claudeAnswer(id, req, "type", false, "bad_ref"); return; }
    if (text == null || text.length() > TYPE_MAX) { claudeAnswer(id, req, "type", false, "bad_text"); return; }
    String js = "(function(r,t){var el=document.querySelector('[data-hub-ref=\"'+r+'\"]');if(!el)return 'missing';el.focus();"
        + "if(el.isContentEditable){el.textContent=t;}else{"
        + "var p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;"
        + "var d=Object.getOwnPropertyDescriptor(p,'value');if(d&&d.set){d.set.call(el,t);}else{el.value=t;}}"
        + "el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return 'ok';})("
        + JSONObject.quote(ref) + "," + JSONObject.quote(text) + ")";
    t.view.evaluateJavascript(js, raw -> {
      String out = decodeJs(raw);
      claudeAnswer(id, req, "type", "ok".equals(out), out);
    });
  }

  /** A picture of the visible page, at most 960 px wide (JPEG), as a data URL. */
  void screenshot(String id, String req) {
    Tab t = tabs.get(id);
    if (t == null || t.view == null || t.view.getWidth() < 4) { claudeAnswer(id, req, "screenshot", false, "no_tab"); return; }
    try {
      float s = Math.min(1f, 960f / t.view.getWidth());
      Bitmap b = Bitmap.createBitmap(Math.max(1, Math.round(t.view.getWidth() * s)), Math.max(1, Math.round(t.view.getHeight() * s)), Bitmap.Config.RGB_565);
      Canvas c = new Canvas(b);
      c.drawColor(Color.WHITE);
      c.scale(s, s);
      t.view.draw(c);
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      b.compress(Bitmap.CompressFormat.JPEG, 80, out);
      claudeAnswer(id, req, "screenshot", true, "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
    } catch (Exception e) {
      android.util.Log.w("HubBrowser", "screenshot", e);
      claudeAnswer(id, req, "screenshot", false, "failed");
    }
  }

  /** Share a link (title optional): the page shows ClaudeOS's share sheet (Copy link, Send to a Claude session). */
  void share(String title, String url) {
    emitGlobal("share", "kind", "link", "title", title == null ? "" : title, "url", url == null ? "" : url);
  }

  void copy(String text) {
    ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
    if (cm != null) {
      ClipData clip = ClipData.newPlainText("link", text);
      // Android 13+ shows its own "copied" preview over the screen unless the clip is marked sensitive
      if (Build.VERSION.SDK_INT >= 33) {
        PersistableBundle x = new PersistableBundle();
        x.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
        clip.getDescription().setExtras(x);
      }
      cm.setPrimaryClip(clip);
    }
    emitGlobal("message", "message", "Link copied");
  }

  /** The long-press menu's choice: newtab, copy, share, download (a link), save (an image). */
  void contextAction(String id, String action, String url, String image) {
    String u = url == null ? "" : url;
    String img = image == null ? "" : image;
    switch (action) {
      case "newtab": if (!u.isEmpty()) emit(id, "newtab", "url", u); break;
      case "copy": copy(u); break;
      case "share": share("", u); break;
      case "download": downloads.start(u, agent(tabs.get(id)), null, null, -1, id); break;
      case "save": downloads.start(img, agent(tabs.get(id)), null, null, -1, id); break;
      default: break;
    }
  }

  /**
   * Opens a downloaded file in ClaudeOS's own viewer (the page draws it): pictures and text are read here and sent
   * as data; anything else, or anything too big, is reported as not previewable. Runs off the UI thread.
   */
  void openFile(String uri, String mime) {
    final String m = mime == null ? "" : mime.toLowerCase();
    new Thread(() -> {
      try {
        boolean image = m.matches("image/(png|jpeg|gif|webp|bmp)");
        boolean text = m.startsWith("text/") || m.equals("application/json") || m.equals("application/xml");
        if (!image && !text) { emitGlobal("viewer", "kind", "none", "mime", m); return; }
        byte[] bytes = readCapped(Uri.parse(uri), image ? VIEW_IMAGE_MAX : VIEW_TEXT_MAX);
        if (bytes == null) { emitGlobal("viewer", "kind", "none", "mime", m, "message", "That file is too big to show here."); return; }
        if (image) emitGlobal("viewer", "kind", "image", "mime", m, "data", "data:" + m + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
        else emitGlobal("viewer", "kind", "text", "mime", m, "text", new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
      } catch (Exception e) {
        android.util.Log.w("HubBrowser", "open file", e);
        emitGlobal("viewer", "kind", "none", "mime", m, "message", "That file can’t be opened.");
      }
    }, "hub-viewer").start();
  }

  /** The bytes of a file, or null when it is longer than `max`. */
  private byte[] readCapped(Uri u, long max) throws java.io.IOException {
    try (InputStream in = act.getContentResolver().openInputStream(u)) {
      if (in == null) throw new java.io.IOException("no stream");
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[64 * 1024];
      long total = 0;
      int n;
      while ((n = in.read(buf)) > 0) {
        total += n;
        if (total > max) return null;
        out.write(buf, 0, n);
      }
      return out.toByteArray();
    }
  }

  /** Sharing a downloaded file is not offered on ClaudeOS yet: the page says so. */
  void shareFile(String uri, String mime) {
    emitGlobal("message", "message", "Files can’t be shared from ClaudeOS yet");
  }

  // ---------- site permissions (the page answers) ----------

  static String[] androidPerms(String kind) {
    switch (kind) {
      case "camera": return new String[] { Manifest.permission.CAMERA };
      case "microphone": return new String[] { Manifest.permission.RECORD_AUDIO };
      case "geolocation": return new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION };
      default: return new String[0];
    }
  }

  private boolean kindGranted(String kind) {
    for (String p : androidPerms(kind)) if (act.checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
    return true;
  }

  private void askPermission(Pending p) {
    String id = "p" + (++seq);
    asking.put(id, p);
    emitGlobal("permission", "reqId", id, "origin", p.origin, "host", host(p.origin), "kinds", String.join(",", p.kinds));
  }

  /** The page's answer to a permission ask. A yes asks Android for anything it hasn't been given yet. */
  void answerPermission(String id, boolean allow) {
    Pending p = asking.remove(id);
    if (p == null) return;
    if (!allow) { deny(p); return; }
    List<String> missing = new ArrayList<>();
    for (String k : p.kinds) for (String perm : androidPerms(k)) {
      if (act.checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED && !missing.contains(perm)) missing.add(perm);
    }
    if (missing.isEmpty()) { finishPermission(p); return; }
    if (act.isOwner()) {   // as device owner the grant is ours: re-apply it silently, so Android's own dialog never shows
      for (String perm : missing) {
        try { act.dpm().setPermissionGrantState(AdminReceiver.component(act), act.getPackageName(), perm, android.app.admin.DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED); }
        catch (RuntimeException e) { android.util.Log.w("HubBrowser", "grant " + perm, e); }
      }
      finishPermission(p);   // a grant that did not take ends as a deny
      return;
    }
    waitingRuntime = p;
    Kiosk.pause(5 * 60_000L);
    act.requestPermissions(missing.toArray(new String[0]), REQ_PERMS);
  }

  /** MainActivity's onRequestPermissionsResult. */
  void permissionResult(int code) {
    if (code != REQ_PERMS || waitingRuntime == null) return;
    Pending p = waitingRuntime;
    waitingRuntime = null;
    finishPermission(p);
  }

  private void deny(Pending p) {
    if (p.geo != null) p.geo.invoke(p.origin, false, false);
    else if (p.req != null) p.req.deny();
  }

  private void finishPermission(Pending p) {
    if (p.geo != null) { p.geo.invoke(p.origin, kindGranted("geolocation"), false); return; }
    List<String> res = new ArrayList<>();
    for (String k : p.kinds) if (kindGranted(k)) res.add("camera".equals(k) ? PermissionRequest.RESOURCE_VIDEO_CAPTURE : PermissionRequest.RESOURCE_AUDIO_CAPTURE);
    if (res.isEmpty()) p.req.deny(); else p.req.grant(res.toArray(new String[0]));
  }

  // ---------- uploads: the page's sheet chooses, this runs the choice ----------

  /**
   * kind: photo (data = a JPEG data URL, the page's own ClaudeOS photo or camera picture), or cancel. Any other kind
   * ends the chooser: the Browser's sheet offers nothing else, and no Android picker or camera app is started.
   */
  void chooseFile(String id, String kind, String data, String name) {
    if (!id.equals(chooserTab) || chooserCb == null) return;
    if ("photo".equals(kind)) {
      Uri u = BrowserFiles.write(act, data, name);
      finishChooser(u == null ? null : new Uri[] { u });
      return;
    }
    finishChooser(null);
  }

  private void finishChooser(Uri[] uris) {
    ValueCallback<Uri[]> cb = chooserCb;
    chooserCb = null;
    chooserTab = "";
    if (cb != null) cb.onReceiveValue(uris);
  }

  /** MainActivity's onActivityResult: the Google sign-in sheet's answer (REQ_CHROME). */
  void onResult(int req, int res, Intent data) {
    if (req == REQ_CHROME) {
      // the sign-in sheet closed (its X, Done, or the sign-in finished): the hub is in front again
      endChrome();
      emit("", "chrome", "state", "closed", "url", chromeUrl);
      chromeUrl = "";
    }
  }

  // ---------- JavaScript dialogs of the tabs: the page's ClaudeOS sheet answers ----------

  /** A tab's alert, confirm or prompt: the page shows it as a sheet, and answerDialog finishes the JsResult. */
  private void askDialog(String tab, String url, String kind, String message, String value, JsResult result) {
    String id = "js" + (++dialogSeq);
    dialogs.put(id, new Dialog(tab, result));
    emit(tab, "dialog", "dialogId", id, "kind", kind, "message", message == null ? "" : message,
        "value", value == null ? "" : value, "host", host(url));
    ui.postDelayed(() -> answerDialog(id, false, ""), 120_000);   // a page that never answers: cancelled
  }

  /** The page's answer: ok (confirm, or the typed text for a prompt) or not. */
  void answerDialog(String id, boolean ok, String text) {
    Dialog d = dialogs.remove(id);
    if (d == null) return;
    if (d.result instanceof JsPromptResult) {
      if (ok) ((JsPromptResult) d.result).confirm(text == null ? "" : text); else d.result.cancel();
    } else if (ok) d.result.confirm();
    else d.result.cancel();
  }

  // ---------- the views ----------

  private Tab tab(String id) {
    Tab t = tabs.get(id);
    if (t == null) { t = new Tab(id); tabs.put(id, t); }
    return t;
  }

  private void layout() {
    for (Map.Entry<String, Tab> e : tabs.entrySet()) {
      WebView v = e.getValue().view;
      if (v == null) continue;
      boolean on = e.getKey().equals(shown) && !covered;
      if (on) {
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(w, h);
        lp.leftMargin = main.getLeft() + x;
        lp.topMargin = main.getTop() + y;
        v.setLayoutParams(lp);
        android.util.Log.i("HubBrowser", "page at " + lp.leftMargin + "," + lp.topMargin + " size " + w + "x" + h);
        final float radius = w * 14f / 872f;   // the content area's 14px corner (872 stage px wide) at the stage's scale
        v.setOutlineProvider(new ViewOutlineProvider() {
          @Override public void getOutline(View view, Outline o) { o.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius); }
        });
        v.setClipToOutline(true);
        if (v.getVisibility() != View.VISIBLE) { v.setVisibility(View.VISIBLE); v.onResume(); }
      } else if (v.getVisibility() != View.GONE) {
        v.setVisibility(View.GONE);
        v.setTranslationY(0);
        v.onPause();   // timers and media stop while hidden
      }
    }
  }

  /** The keyboard came or went: the page on screen pans so its focused field stays above it (MainActivity.panPage). */
  void keyboardPan() {
    Tab t = shown == null ? null : tabs.get(shown);
    if (t != null && t.view != null && !covered) act.panPage(t.view);
  }

  /** Plain http to anything but the PC or a home-network address becomes https; anything not http(s) is refused (null). */
  String allowed(String url) {
    if (url == null) return null;
    Uri u = Uri.parse(url);
    String s = u.getScheme();
    if ("https".equalsIgnoreCase(s)) return url;
    if ("http".equalsIgnoreCase(s)) return plainOk(url) ? url : "https" + url.substring(4);
    if ("about".equalsIgnoreCase(s) && "about:blank".equals(url)) return url;
    return null;
  }

  /** Plain http is fine to the Hub and to home-network addresses; any other plain http is upgraded (or refused). */
  boolean plainOk(String url) {
    return act.isServer(url) || isLocalHost(Uri.parse(url).getHost());
  }

  /**
   * A link the Claude page sent (Bridge.browserOpenUrl), for a new tab of the Browser. It is kept as the incoming link
   * exactly as a VIEW intent's is, and the Browser page is told to take it: now if it is up, else when it mounts.
   * Returns the link as the Browser will open it, or null when it is refused (not http(s), or allowed() says no).
   */
  String offer(String url) {
    String s = Uri.parse(url).getScheme();
    if (!"http".equalsIgnoreCase(s) && !"https".equalsIgnoreCase(s)) return null;
    String ok = allowed(url);
    if (ok == null) return null;
    incoming = ok;
    post(() -> main.evaluateJavascript("window.hubBrowserIncoming && window.hubBrowserIncoming()", null));
    return ok;
  }

  /** localhost, 127.x, 169.254.x (link-local), 10.x, 192.168.x, 172.16-31.x, *.local, *.lan, *.home, home.arpa: as state.ts. */
  static boolean isLocalHost(String host) {
    if (host == null) return false;
    return host.toLowerCase(java.util.Locale.ROOT).matches(
        "localhost|127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|169\\.254\\.\\d{1,3}\\.\\d{1,3}"
        + "|192\\.168\\.\\d{1,3}\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}"
        + "|([a-z0-9-]+\\.)+(local|lan|home|home\\.arpa)");
  }

  private void load(String id, WebView v, String url) {
    String ok = allowed(url);
    if (ok == null) { emit(id, "blocked", "url", url); return; }
    if (openedInChrome(id, ok)) return;
    v.loadUrl(ok);
  }

  /**
   * Google's sign-in pages (accounts.google.com) open in Chrome instead, as a Custom Tab: Google doesn't accept its
   * sign-in inside an embedded browser, and a WebView can't hide that. Only these pages; everything else stays here.
   * The Custom Tab is the raw Chrome Custom Tab intent (no AndroidX Browser library); Chrome has its own cookies, so
   * signing in there does not sign the Browser in. The Browser settings' "Google sign-in" row chooses: the Chrome panel
   * (the default, true) or these pages in the Browser itself (false). Nothing is disguised in the Browser: no user agent
   * or X-Requested-With change. Google may refuse; isGoogleRejected() then tells the page.
   */
  private static final String PREF_GOOGLE_CHROME = "googleSigninChrome";
  static boolean googleInChrome(android.content.Context c) {
    return c.getSharedPreferences("hub", android.content.Context.MODE_PRIVATE).getBoolean(PREF_GOOGLE_CHROME, true);
  }
  static void setGoogleInChrome(android.content.Context c, boolean on) {
    c.getSharedPreferences("hub", android.content.Context.MODE_PRIVATE).edit().putBoolean(PREF_GOOGLE_CHROME, on).apply();
  }
  /** Google's "this browser may not be secure" page (the sign-in was refused for an embedded browser). */
  static boolean isGoogleRejected(String url) {
    if (!isGoogleSignIn(url)) return false;
    String p = Uri.parse(url).getPath();
    return (p != null && p.contains("/signin/rejected")) || url.contains("disallowed_useragent");
  }
  static boolean isGoogleSignIn(String url) {
    if (url == null) return false;
    Uri u = Uri.parse(url);
    String h = u.getHost();
    return "https".equalsIgnoreCase(u.getScheme()) && h != null && (h.equals("accounts.google.com") || h.equals("accounts.youtube.com"));
  }

  /** Chrome's answer comes back here when the sign-in tab closes (onResult). */
  static final int REQ_CHROME = 73;

  /** True when the page was handed to Chrome (and the tab is left as it is). */
  boolean openedInChrome(String tab, String url) {
    if (!googleInChrome(act) || !isGoogleSignIn(url)) return false;
    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(Launcher.CHROME);
    i.addCategory(Intent.CATEGORY_BROWSABLE);
    chromeSheet(i);
    if (act.getPackageManager().resolveActivity(i, 0) == null) {
      emit(tab, "blocked", "url", url, "message", "Google sign-in needs Chrome on this tablet");
      return true;
    }
    if (chrome != null) { emit(tab, "blocked", "url", url, "message", "Google sign-in is already open in Chrome"); return true; }
    emit(tab, "blocked", "url", url, "message", "Google sign-in opens in Chrome");
    // Chrome may run inside lock task only while this sign-in is open; the tablet stays pinned (no unpin here)
    Launcher.setChromeForSignIn(act, true);
    chrome = new ChromeTab(act, this::chromeLayout);
    chromeUrl = url;
    // a real session first (warmup + newSession with Chrome's service), then the tab; no unbound session
    chrome.connect(session -> launchChrome(i, session));
    return true;
  }

  /** The Custom Tab's session tab: Chrome's service-made session goes in as the session extra (null: none). */
  private ChromeTab chrome;
  private String chromeUrl = "";

  /** Starts Chrome's sheet with startActivityForResult (REQ_CHROME) and no NEW_TASK, so it sits in the hub's task. */
  private void launchChrome(Intent i, android.os.IBinder session) {
    if (chrome == null) return;
    if (session != null) {
      android.os.Bundle b = new android.os.Bundle();
      b.putBinder(ChromeTab.EXTRA_SESSION, session);
      i.putExtras(b);
    }
    // no system bars and no home gesture while the sheet is up (MainActivity.chromeSheet), before Chrome takes focus
    act.chromeSheet(true);
    try {
      act.startActivityForResult(i, REQ_CHROME);
      // the width we asked for, until Chrome reports where it really put the sheet (chromeLayout)
      int sw = act.getResources().getDisplayMetrics().widthPixels;
      sheetLeft = sw - Math.round(sw * SHEET_FRACTION);
      emitChromeOpen(session != null);
    } catch (Exception e) {
      endChrome();
      emitGlobal("message", "message", "Nothing on the tablet can open that");
    }
  }

  /** The sheet's left edge in screen px (the hub lays out left of it); -1 when no sheet is open. */
  private int sheetLeft = -1;
  private boolean sheetSession = false;

  /**
   * Tells the page the sheet is open and where: left = the sheet's left edge and width = its width, in screen px.
   * The page fits Claude Home into the space left of it (dom.ts setStageInset).
   */
  private void emitChromeOpen(boolean session) {
    sheetSession = session;
    int sw = act.getResources().getDisplayMetrics().widthPixels;
    emit("", "chrome", "state", "open", "url", chromeUrl, "session", session, "left", sheetLeft, "width", Math.max(0, sw - sheetLeft));
  }

  /** Chrome's own report of the sheet's window (ChromeTab.Layout): a side sheet's left edge is what the hub needs. */
  private void chromeLayout(int left, int top, int right, int bottom, int state) {
    if (chrome == null || sheetLeft < 0) return;
    int sw = act.getResources().getDisplayMetrics().widthPixels;
    // side sheet (3) or unknown (0, from onActivityResized) on the right: the hub keeps what is left of it.
    // Maximized or full screen (4, 5): the sheet covers everything, so the hub keeps its full layout under it.
    // A bottom sheet (1, 2) leaves the full width: no change either.
    int l = (state == 3 || state == 0) && left > 0 && right >= sw - 2 ? left : sw;
    if (l == sheetLeft) return;
    sheetLeft = l;
    emitChromeOpen(sheetSession);
  }

  /** Drops the session, puts Chrome back off the lock task allowlist, and gives the hub its bars policy back. */
  private void endChrome() {
    Launcher.setChromeForSignIn(act, false);
    if (chrome != null) { chrome.close(); chrome = null; }
    sheetLeft = -1;
    act.chromeSheet(false);
  }

  /** The panel's Done: finishes Chrome's sheet, so Claude Home is in front again (onResult then reports it closed). */
  void chromeDone() {
    if (chrome == null) return;
    try { act.finishActivity(REQ_CHROME); } catch (Exception e) { android.util.Log.w("HubBrowser", "finish chrome", e); }
  }

  /** How much of the screen's width the sheet asks for; Claude Home keeps the rest, on the left. */
  static final float SHEET_FRACTION = 0.45f;

  /**
   * Chrome's Custom Tab, dressed as Claude Home: a partial tab (a side sheet on the right) so the hub stays visible
   * beside it, in the hub's colours, with Claude Home's close icon and as little of Chrome's own UI as Chrome allows.
   * Raw extras only (no AndroidX); every key and value below is checked against androidx.browser's CustomTabsIntent.
   *
   * What Chrome does not let a third-party app remove: the toolbar itself (title and address) and the ⋮ menu button.
   * Chrome hides the menu only for its media-viewer UI type, which it accepts only from Google's own trusted apps.
   * So the toolbar is coloured like Claude Home and the menu is cut down to the least (no share, bookmark,
   * download or "Open in Chrome").
   */
  private void chromeSheet(Intent i) {
    android.util.DisplayMetrics dm = act.getResources().getDisplayMetrics();
    Integer hub = MainActivity.claudeHomeColor();
    boolean dark = hub != null && Color.luminance(hub) < 0.5f;
    int scheme = dark ? 2 : 1;   // COLOR_SCHEME_DARK / COLOR_SCHEME_LIGHT

    // Chrome picks the params of the scheme named here (it never resolves SYSTEM itself): both are given, and the
    // chosen one is also put at the top level (CustomTabsIntent.Builder.setDefaultColorSchemeParams does that)
    i.putExtra("androidx.browser.customtabs.extra.COLOR_SCHEME", scheme);
    putColors(null, i, dark);
    android.util.SparseArray<android.os.Bundle> params = new android.util.SparseArray<>();
    for (int s : new int[] { 1, 2 }) {
      android.os.Bundle b = new android.os.Bundle();
      putColors(b, null, s == 2);
      params.put(s, b);
    }
    android.os.Bundle paramsExtra = new android.os.Bundle();
    paramsExtra.putSparseParcelableArray("androidx.browser.customtabs.extra.COLOR_SCHEME_PARAMS", params);
    i.putExtras(paramsExtra);

    i.putExtra("android.support.customtabs.extra.TITLE_VISIBILITY", 1);          // SHOW_PAGE_TITLE
    // Chrome keeps a close icon only when it is exactly its toolbar_icon_height (24 dp) square; anything else is
    // dropped for Chrome's own ✕. At this tablet's density (120 dpi) that is 18 px, not 48.
    i.putExtra("android.support.customtabs.extra.CLOSE_BUTTON_ICON", closeIcon(dark ? 0xFFFAF9F5 : 0xFF141413, chromeIconPx(dm)));
    i.putExtra("androidx.browser.customtabs.extra.CLOSE_BUTTON_POSITION", 1);   // START: where Claude Home's close sits
    // the menu, cut down: no share, no "Open in Chrome", no bookmark star, no download
    i.putExtra("androidx.browser.customtabs.extra.SHARE_STATE", 2);              // SHARE_STATE_OFF
    i.putExtra("android.support.customtabs.extra.SHARE_MENU_ITEM", false);       // the same, for older Chrome
    i.putExtra("androidx.browser.customtabs.extra.OPEN_IN_BROWSER_STATE", 2);    // OPEN_IN_BROWSER_STATE_OFF
    i.putExtra("org.chromium.chrome.browser.customtabs.EXTRA_DISABLE_STAR_BUTTON", true);      // bookmark
    i.putExtra("org.chromium.chrome.browser.customtabs.EXTRA_DISABLE_DOWNLOAD_BUTTON", true);
    // the hub stays interactive beside the sheet: DISABLE_BACKGROUND_INTERACTION is simply not set (there is no
    // "enable" extra; the default is that the background can be used)

    // a side sheet on the right, always (the breakpoint is below the tablet's width), square-cornered, with a plain
    // divider line between it and the hub, no drag handle (that only appears with rounded corners) and no maximize
    i.putExtra("androidx.browser.customtabs.extra.ACTIVITY_SIDE_SHEET_BREAKPOINT_DP", 600);
    i.putExtra("androidx.browser.customtabs.extra.ACTIVITY_SIDE_SHEET_POSITION", 2);             // END (right)
    i.putExtra("androidx.browser.customtabs.extra.ACTIVITY_SIDE_SHEET_DECORATION_TYPE", 3);     // DIVIDER: a split
    i.putExtra("androidx.browser.customtabs.extra.ACTIVITY_SIDE_SHEET_ROUNDED_CORNERS_POSITION", 1);   // NONE
    i.putExtra("androidx.browser.customtabs.extra.TOOLBAR_CORNER_RADIUS_DP", 0);
    i.putExtra("androidx.browser.customtabs.extra.ACTIVITY_SIDE_SHEET_ENABLE_MAXIMIZATION", false);
    i.putExtra("androidx.browser.customtabs.extra.INITIAL_ACTIVITY_WIDTH_PX", Math.round(dm.widthPixels * SHEET_FRACTION));
  }

  /** Claude Home's sheet colours: toolbar = page background, bottom/nav = card, divider = card (no line). */
  private static void putColors(android.os.Bundle b, Intent i, boolean dark) {
    int toolbar = dark ? 0xFF141413 : 0xFFFAF9F5, card = dark ? 0xFF1B1A19 : 0xFFF0EEE6;
    String[] keys = {
      "android.support.customtabs.extra.TOOLBAR_COLOR",
      "android.support.customtabs.extra.SECONDARY_TOOLBAR_COLOR",
      "androidx.browser.customtabs.extra.NAVIGATION_BAR_COLOR",
      "androidx.browser.customtabs.extra.NAVIGATION_BAR_DIVIDER_COLOR",
    };
    int[] vals = { toolbar, card, card, card };
    for (int k = 0; k < keys.length; k++) {
      if (b != null) b.putInt(keys[k], vals[k]);
      if (i != null) i.putExtra(keys[k], vals[k]);
    }
  }

  /** Chrome's toolbar_icon_height in px, read from Chrome's own resources (24 dp at our density if that fails). */
  private int chromeIconPx(android.util.DisplayMetrics dm) {
    try {
      android.content.res.Resources r = act.getPackageManager().getResourcesForApplication(Launcher.CHROME);
      int id = r.getIdentifier("toolbar_icon_height", "dimen", Launcher.CHROME);
      if (id != 0) return r.getDimensionPixelSize(id);
    } catch (Exception e) { android.util.Log.w("HubChrome", "toolbar_icon_height", e); }
    return Math.max(1, Math.round(24 * dm.density));
  }

  /** The close icon for the tab's toolbar: an X in the hub's ink colour, size px square (Chrome's exact icon size). */
  private Bitmap closeIcon(int color, int size) {
    Bitmap b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
    Canvas c = new Canvas(b);
    android.graphics.Paint p = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
    p.setColor(color);
    p.setStyle(android.graphics.Paint.Style.STROKE);
    p.setStrokeWidth(Math.max(1.5f, size / 12f));   // the same weight as the hub's 1.8/20 strokes
    p.setStrokeCap(android.graphics.Paint.Cap.ROUND);
    float a = size * 0.29f, z = size * 0.71f;
    c.drawLine(a, a, z, z, p);
    c.drawLine(z, a, a, z, p);
    android.util.Log.i("HubChrome", "close icon " + size + "px");
    return b;
  }

  @SuppressLint("SetJavaScriptEnabled")
  private WebView view(String id) {
    Tab t = tab(id);
    if (t.view != null) return t.view;
    WebView v = new WebView(act);
    t.view = v;
    v.setBackgroundColor(Color.WHITE);
    v.setVisibility(View.GONE);
    WebSettings s = v.getSettings();
    userAgent(s.getUserAgentString());     // remembers the tablet's own user agent before any change
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(!t.priv);
    s.setDatabaseEnabled(!t.priv);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setGeolocationEnabled(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    s.setSupportZoom(true);
    s.setBuiltInZoomControls(true);
    s.setDisplayZoomControls(false);
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setMediaPlaybackRequiresUserGesture(true);
    s.setSupportMultipleWindows(true);             // target=_blank comes to onCreateWindow, which opens a tab
    s.setJavaScriptCanOpenWindowsAutomatically(false);
    s.setSafeBrowsingEnabled(true);
    s.setCacheMode(t.priv ? WebSettings.LOAD_NO_CACHE : WebSettings.LOAD_DEFAULT);
    // Google's sign-in refuses an embedded browser that announces itself: no X-Requested-With header to any site
    // (the WebView this tablet runs, Android System WebView 151, doesn't offer this feature: the header is still sent)
    if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
      WebSettingsCompat.setRequestedWithHeaderOriginAllowList(s, Collections.<String>emptySet());
    }
    v.setImportantForAutofill(t.priv ? View.IMPORTANT_FOR_AUTOFILL_NO : View.IMPORTANT_FOR_AUTOFILL_YES);
    applyAgent(t);
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(v, false);
    final String tab = id;
    v.setWebViewClient(new Client(tab));   // main frame: shouldOverrideUrlLoading; subresources: shouldInterceptRequest
    v.setWebChromeClient(new Chrome(tab));
    v.setDownloadListener((url, ua, disposition, mime, length) -> downloads.start(url, ua, disposition, mime, length, tab));
    v.setFindListener((active, count, done) -> emit(tab, "find", "count", count, "index", count > 0 ? active + 1 : 0, "done", done));
    v.setOnLongClickListener(view -> contextMenu(tab, v));
    // above the Claude Home page, below anything MainActivity adds over it (the status-bar strip, the cover)
    int at = root.indexOfChild(main) + 1;
    root.addView(v, Math.max(0, Math.min(at, root.getChildCount())), new FrameLayout.LayoutParams(1, 1));
    return v;
  }

  /** Long-press on a link or image: the page shows its sheet with what it finds here. */
  private boolean contextMenu(String tab, WebView v) {
    WebView.HitTestResult h = v.getHitTestResult();
    if (h == null) return false;
    int type = h.getType();
    String extra = h.getExtra();
    if (type == WebView.HitTestResult.SRC_ANCHOR_TYPE) {
      emit(tab, "context", "kind", "link", "url", extra == null ? "" : extra, "image", "");
      return true;
    }
    if (type == WebView.HitTestResult.IMAGE_TYPE) {
      emit(tab, "context", "kind", "image", "url", "", "image", extra == null ? "" : extra);
      return true;
    }
    if (type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) {
      Handler hh = new Handler(Looper.getMainLooper(), msg -> {
        String link = msg.getData() == null ? "" : msg.getData().getString("url", "");
        emit(tab, "context", "kind", "imagelink", "url", link == null ? "" : link, "image", extra == null ? "" : extra);
        return true;
      });
      v.requestFocusNodeHref(hh.obtainMessage());
      return true;
    }
    return false;
  }

  /** The user agent for this tab: the phone-like Chrome (the default) or a desktop Chrome. */
  private void applyAgent(Tab t) {
    if (t.view == null) return;
    WebSettings s = t.view.getSettings();
    s.setUserAgentString(t.desktop ? desktopUserAgent() : userAgent(s.getUserAgentString()));
    s.setUseWideViewPort(true);
  }

  private String agent(Tab t) { return t == null || t.view == null ? userAgent(null) : t.view.getSettings().getUserAgentString(); }

  /** The WebView's own user agent, without the "; wv" and "Version/4.0" marks: a normal Chrome on a tablet. */
  private String userAgent(String base) {
    if (userAgent == null && base != null) {
      userAgent = base.replace("; wv)", ")").replaceAll("Version/\\d+\\.\\d+ ", "");
    }
    return userAgent == null ? "" : userAgent;
  }

  /** A desktop Chrome on Linux with the same Chrome version as the tablet's. */
  private String desktopUserAgent() {
    String u = userAgent(null);
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("Chrome/[\\d.]+").matcher(u);
    String chrome = m.find() ? m.group() : "Chrome/120.0.0.0";
    return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " + chrome + " Safari/537.36";
  }

  /** Removes the cookies the sites of a private tab set (the tab's own host and its parent domains). */
  private void clearCookiesFor(Set<String> hosts) {
    CookieManager cm = CookieManager.getInstance();
    for (String host : hosts) {
      String h = host;
      while (h != null && h.contains(".")) {
        String url = "https://" + h + "/";
        String all = cm.getCookie(url);
        if (all != null) {
          for (String part : all.split(";")) {
            String name = part.split("=", 2)[0].trim();
            if (!name.isEmpty()) cm.setCookie(url, name + "=; Max-Age=0; Path=/; Domain=" + h);
          }
        }
        int dot = h.indexOf('.');
        h = dot < 0 ? null : h.substring(dot + 1);
      }
    }
    cm.flush();
  }

  private static String host(String u) {
    if (u == null) return "";
    String h = Uri.parse(u).getHost();
    if (h == null) return u;
    return h.startsWith("www.") ? h.substring(4) : h;
  }

  /** A network failure a second try may fix (the site timed out, the name didn't resolve, the connection was refused
   *  or dropped, the tablet is offline). A refused site, a bad certificate or a bad address is not retryable. */
  static boolean isRetryable(int code, String desc) {
    if (code == WebViewClient.ERROR_TIMEOUT || code == WebViewClient.ERROR_HOST_LOOKUP
        || code == WebViewClient.ERROR_CONNECT || code == WebViewClient.ERROR_IO) return true;
    if (desc == null) return false;
    return desc.contains("NAME_NOT_RESOLVED") || desc.contains("INTERNET_DISCONNECTED") || desc.contains("NETWORK_CHANGED")
        || desc.contains("CONNECTION_REFUSED") || desc.contains("CONNECTION_RESET") || desc.contains("CONNECTION_TIMED_OUT")
        || desc.contains("TIMED_OUT");
  }

  private class Client extends WebViewClient {
    private final String tab;
    Client(String tab) { this.tab = tab; }

    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
      if (!r.isForMainFrame()) return false;
      String url = r.getUrl().toString();
      String ok = allowed(url);
      if (ok == null) { emit(tab, "blocked", "url", url); return true; }
      if (openedInChrome(tab, ok)) return true;
      if (!ok.equals(url)) { v.loadUrl(ok); return true; }
      return false;
    }
    /**
     * The gate for everything the page loads over plain http (the network security config allows it app-wide):
     * a page's own subresources (images, scripts, frames) to a public address are refused; the Hub and home-network
     * addresses load. A public main-frame http that got this far (a redirect the navigation check missed) is refused
     * too, and only then does the page say "That page isn't secure".
     */
    @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
      Uri u = r.getUrl();
      if (u == null || !"http".equalsIgnoreCase(u.getScheme()) || plainOk(u.toString())) return null;
      if (r.isForMainFrame()) ui.post(() -> emit(tab, "error", "url", u.toString(), "code", -1, "message", "CLEARTEXT_BLOCKED",
          "canGoBack", v.canGoBack(), "canGoForward", v.canGoForward(), "retryable", false));
      return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", Collections.<String, String>emptyMap(),
          new java.io.ByteArrayInputStream(new byte[0]));
    }
    @Override public void onPageStarted(WebView v, String url, Bitmap icon) {
      recordHost(url);
      emit(tab, "progress", "progress", 5, "loading", true, "canGoBack", v.canGoBack(), "canGoForward", v.canGoForward());
    }
    @Override public void onPageFinished(WebView v, String url) {
      if (isGoogleRejected(url)) emit(tab, "error", "url", url, "code", -1, "message", "GOOGLE_SIGNIN_REJECTED",
          "canGoBack", v.canGoBack(), "canGoForward", v.canGoForward(), "retryable", false);
      emit(tab, "progress", "progress", 100, "loading", false, "canGoBack", v.canGoBack(), "canGoForward", v.canGoForward());
    }
    @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) {
      if (url == null || url.startsWith("data:") || "about:blank".equals(url)) return;
      recordHost(url);
      emit(tab, "url", "url", url, "canGoBack", v.canGoBack(), "canGoForward", v.canGoForward());
    }
    private void recordHost(String url) {
      Tab t = tabs.get(tab);
      if (t == null || url == null) return;
      String h = Uri.parse(url).getHost();
      if (h != null) t.hosts.add(h);
    }
    @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
      if (!r.isForMainFrame()) return;
      String desc = String.valueOf(e.getDescription());
      emit(tab, "error", "url", r.getUrl().toString(), "code", e.getErrorCode(), "message", desc,
          "canGoBack", v.canGoBack(), "canGoForward", v.canGoForward(), "retryable", isRetryable(e.getErrorCode(), desc));
    }
    @Override public void onReceivedSslError(WebView v, SslErrorHandler handler, SslError e) {
      handler.cancel();   // never proceed past a bad certificate
      emit(tab, "error", "url", e.getUrl(), "code", -11, "message", "SSL_ERROR " + e.getPrimaryError(),
          "canGoBack", v.canGoBack(), "canGoForward", v.canGoForward(), "retryable", false);
    }
    /** The page's renderer died: the tab says so (and can be reloaded) instead of Android's "has stopped" dialog. */
    @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
      emit(tab, "error", "url", v.getUrl() == null ? "" : v.getUrl(), "code", -1, "message", "This page stopped. Reload it to try again.",
          "canGoBack", v.canGoBack(), "canGoForward", v.canGoForward(), "retryable", true);
      return true;
    }
  }

  private class Chrome extends WebChromeClient {
    private final String tab;
    Chrome(String tab) { this.tab = tab; }

    @Override public void onProgressChanged(WebView v, int p) {
      emit(tab, "progress", "progress", p, "loading", p < 100);
    }
    @Override public void onReceivedTitle(WebView v, String title) { emit(tab, "title", "title", title); }
    @Override public void onReceivedIcon(WebView v, Bitmap icon) {
      try {
        Bitmap b = Bitmap.createScaledBitmap(icon, 32, 32, true);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, out);
        emit(tab, "favicon", "icon", "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
      } catch (Exception ignored) { }
    }
    /** target=_blank / window.open from a tap: catch the address in a throwaway view, then ask the page for a new tab. */
    @Override public boolean onCreateWindow(WebView v, boolean dialog, boolean userGesture, Message resultMsg) {
      if (!userGesture) return false;   // no pop-ups
      WebView catcher = new WebView(act);
      catcher.setWebViewClient(new WebViewClient() {
        private boolean done = false;
        @Override public boolean shouldOverrideUrlLoading(WebView c, WebResourceRequest r) { grab(c, r.getUrl().toString()); return true; }
        @Override public void onPageStarted(WebView c, String url, Bitmap icon) { grab(c, url); }
        private void grab(WebView c, String url) {
          if (done || url == null || "about:blank".equals(url)) return;
          done = true;
          String ok = allowed(url);
          if (ok == null) emit(tab, "blocked", "url", url); else emit(tab, "newtab", "url", ok);
          ui.post(c::destroy);
        }
      });
      WebView.WebViewTransport t = (WebView.WebViewTransport) resultMsg.obj;
      t.setWebView(catcher);
      resultMsg.sendToTarget();
      return true;
    }
    @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
      Pending p = new Pending();
      p.geo = cb; p.origin = origin; p.kinds.add("geolocation");
      askPermission(p);
    }
    @Override public void onPermissionRequest(PermissionRequest r) {
      Pending p = new Pending();
      p.req = r;
      p.origin = r.getOrigin() == null ? "" : r.getOrigin().toString();
      for (String res : r.getResources()) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) && !p.kinds.contains("camera")) p.kinds.add("camera");
        else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) && !p.kinds.contains("microphone")) p.kinds.add("microphone");
      }
      if (p.kinds.isEmpty()) { r.deny(); return; }   // protected media, MIDI and the rest are refused
      askPermission(p);
    }
    @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
      if (chooserCb != null) chooserCb.onReceiveValue(null);
      chooserCb = cb;
      chooserTab = tab;
      chooserMulti = p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
      StringBuilder acc = new StringBuilder();
      String[] types = p.getAcceptTypes();
      if (types != null) for (String s : types) { if (s != null && !s.isEmpty()) { if (acc.length() > 0) acc.append(','); acc.append(s); } }
      chooserAccept = acc.toString();
      emit(tab, "chooser", "accept", chooserAccept, "multiple", chooserMulti, "capture", p.isCaptureEnabled());
      return true;
    }
    // alert, confirm and prompt from the page: ClaudeOS sheets (askDialog), never Android's dialogs
    @Override public boolean onJsAlert(WebView v, String url, String message, JsResult r) {
      askDialog(tab, url, "alert", message, "", r);
      return true;
    }
    @Override public boolean onJsConfirm(WebView v, String url, String message, JsResult r) {
      askDialog(tab, url, "confirm", message, "", r);
      return true;
    }
    @Override public boolean onJsPrompt(WebView v, String url, String message, String def, JsPromptResult r) {
      askDialog(tab, url, "prompt", message, def, r);
      return true;
    }
    @Override public boolean onJsBeforeUnload(WebView v, String url, String message, JsResult r) {
      r.confirm();   // leaving the page is never held up by a dialog
      return true;
    }
  }

  // ---------- events to the page ----------

  /** window.hubBrowser({tab, type, k1: v1, ...}) on the Claude Home page. */
  void emit(String tab, String type, Object... kv) {
    try {
      JSONObject o = new JSONObject();
      o.put("tab", tab);
      o.put("type", type);
      for (int i = 0; i + 1 < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]);
      final String js = "window.hubBrowser && window.hubBrowser(" + o + ")";
      ui.post(() -> main.evaluateJavascript(js, null));
    } catch (Exception ignored) { }
  }

  void emitGlobal(String type, Object... kv) { emit("", type, kv); }

  /** Reads the page of an article: title, byline and the text blocks, as JSON (a string). */
  private static final String READER_JS =
      "(function(){"
    + "function t(el){return (el.innerText||'').replace(/\\s+/g,' ').trim();}"
    + "var c=[].slice.call(document.querySelectorAll('article,main,[role=main],.article,.post,.entry-content,.post-content,#content,#main'));"
    + "if(!c.length)c=[document.body];"
    + "var best=null,bl=0;c.forEach(function(e){var l=t(e).length;if(l>bl){bl=l;best=e;}});"
    + "var root=best||document.body,blocks=[];"
    + "root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre').forEach(function(el){"
    + "if(el.closest('nav,header,footer,aside,form,script,style,[aria-hidden=true]'))return;"
    + "if(el.tagName==='LI'&&el.querySelector('p'))return;"
    + "var s=t(el);if(s.length<2)return;blocks.push({tag:el.tagName.toLowerCase(),text:s});});"
    + "var total=0;blocks.forEach(function(b){total+=b.text.length;});"
    + "var m=function(n){var e=document.querySelector('meta[name=\"'+n+'\"],meta[property=\"'+n+'\"]');return e?e.content:'';};"
    + "return JSON.stringify({title:m('og:title')||document.title||'',byline:m('author'),host:location.hostname,"
    + "blocks:blocks.slice(0,800),chars:total,ok:total>300});"
    + "})()";
}
