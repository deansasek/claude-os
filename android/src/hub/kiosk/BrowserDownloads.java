package hub.kiosk;

import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.List;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/**
 * Downloads for the Browser: web files go through Android's DownloadManager into Download/ (it does the transfer,
 * the retries and the progress), and images the page holds as data: URLs are written to Download/ through
 * MediaStore. Progress and the end of each download go to the page as window.hubBrowser({type: 'download'}),
 * with tab "" since a download belongs to no tab. Files are opened and shared through their content Uri
 * (DownloadManager's own, or MediaStore's), so no file path is ever handed out.
 */
final class BrowserDownloads {
  private final BrowserView bv;
  private final Context ctx;
  private final DownloadManager dm;
  private final Handler ui = new Handler(Looper.getMainLooper());
  private final Set<Long> active = new HashSet<>();
  private boolean polling = false;
  private final Runnable tick = this::poll;

  BrowserDownloads(BrowserView bv, Context ctx) {
    this.bv = bv;
    this.ctx = ctx;
    this.dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
  }

  /** A link or image to save. tab only tells the page where it came from. */
  void start(String url, String ua, String disposition, String mime, long length, String tab) {
    if (url == null || url.isEmpty()) return;
    if (url.startsWith("data:")) { saveData(url, tab); return; }
    // the same rule as a page: public http is upgraded to https; anything not http(s) is refused
    String ok = bv.allowed(url);
    if (ok == null || ok.startsWith("about:")) {
      bv.emitGlobal("download", "id", 0L, "state", "failed", "name", "", "message", "This kind of file can’t be saved yet");
      return;
    }
    url = ok;
    try {
      String name = URLUtil.guessFileName(url, disposition, mime);
      DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
      r.setTitle(name);
      r.setDescription(Uri.parse(url).getHost());
      if (mime != null && !mime.isEmpty()) r.setMimeType(mime);
      r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
      if (ua != null && !ua.isEmpty()) r.addRequestHeader("User-Agent", ua);
      String cookie = CookieManager.getInstance().getCookie(url);   // the site's own sign-in, so private files download
      if (cookie != null) r.addRequestHeader("Cookie", cookie);
      // No download notification (the Browser's Downloads page shows progress). Without the permission that hides
      // it, Android refuses the hidden setting at enqueue, so that case keeps the notification.
      long id;
      r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_HIDDEN);
      try { id = dm.enqueue(r); }
      catch (SecurityException e) {
        r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
        id = dm.enqueue(r);
      }
      active.add(id);
      remember(String.valueOf(id));
      bv.emitGlobal("download", "id", id, "state", "running", "name", name, "mime", mime == null ? "" : mime,
          "bytes", 0L, "total", length, "url", url, "tab", tab);
      startPolling();
    } catch (Exception e) {
      android.util.Log.w("HubBrowser", "download", e);
      bv.emitGlobal("download", "id", 0L, "state", "failed", "name", "", "message", "That download didn’t start");
    }
  }

  /** A data: image (from a long-press) into Download/, through MediaStore (Android 10 and up). */
  private void saveData(String dataUrl, String tab) {
    try {
      int comma = dataUrl.indexOf(',');
      String head = dataUrl.substring(5, comma);
      String mime = head.split(";")[0];
      byte[] bytes = head.endsWith(";base64")
          ? Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
          : URLDecoder.decode(dataUrl.substring(comma + 1), StandardCharsets.UTF_8.name()).getBytes(StandardCharsets.UTF_8);
      if (Build.VERSION.SDK_INT < 29) {
        bv.emitGlobal("download", "id", 0L, "state", "failed", "name", "", "message", "Saving needs newer tablet software");
        return;
      }
      String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
      String name = "image-" + System.currentTimeMillis() + "." + (ext == null ? "bin" : ext);
      ContentResolver cr = ctx.getContentResolver();
      ContentValues cv = new ContentValues();
      cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
      cv.put(MediaStore.Downloads.MIME_TYPE, mime);
      cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
      cv.put(MediaStore.Downloads.IS_PENDING, 1);
      Uri u = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
      if (u == null) throw new IllegalStateException("no MediaStore row");
      try (OutputStream out = cr.openOutputStream(u)) { out.write(bytes); }
      ContentValues done = new ContentValues();
      done.put(MediaStore.Downloads.IS_PENDING, 0);
      cr.update(u, done, null, null);
      remember(u.toString());
      bv.emitGlobal("download", "id", 0L, "state", "done", "name", name, "mime", mime, "uri", u.toString(),
          "bytes", bytes.length, "total", bytes.length, "tab", tab);
    } catch (Exception e) {
      android.util.Log.w("HubBrowser", "save image", e);
      bv.emitGlobal("download", "id", 0L, "state", "failed", "name", "", "message", "That picture didn’t save");
    }
  }

  private void startPolling() {
    if (polling) return;
    polling = true;
    ui.postDelayed(tick, 700);
  }

  /** Progress for the downloads in flight; each one's end is reported once. */
  private void poll() {
    if (active.isEmpty()) { polling = false; return; }
    long[] ids = toArray(active);
    Set<Long> seen = new HashSet<>();
    Cursor c = dm.query(new DownloadManager.Query().setFilterById(ids));
    try {
      while (c != null && c.moveToNext()) {
        long id = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));
        int st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
        seen.add(id);
        if (st == DownloadManager.STATUS_SUCCESSFUL) {
          active.remove(id);
          bv.emitGlobal("download", "id", id, "state", "done", "name", c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)),
              "mime", str(dm.getMimeTypeForDownloadedFile(id)), "uri", str(dm.getUriForDownloadedFile(id)),
              "bytes", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
              "total", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
        } else if (st == DownloadManager.STATUS_FAILED) {
          active.remove(id);
          bv.emitGlobal("download", "id", id, "state", "failed", "name", c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)),
              "message", "The download stopped (" + c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)) + ")");
        } else {
          bv.emitGlobal("download", "id", id, "state", "running",
              "bytes", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
              "total", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
        }
      }
    } finally {
      if (c != null) c.close();
    }
    for (long id : ids) if (!seen.contains(id)) { active.remove(id); bv.emitGlobal("download", "id", id, "state", "gone"); }
    if (!active.isEmpty()) ui.postDelayed(tick, 700); else polling = false;
  }

  /** The page's check on downloads it holds (a comma list of ids): their state now, as JSON. */
  String info(String csv) {
    JSONArray out = new JSONArray();
    try {
      long[] ids = parseIds(csv);
      if (ids.length == 0) return out.toString();
      Cursor c = dm.query(new DownloadManager.Query().setFilterById(ids));
      Set<Long> seen = new HashSet<>();
      try {
        while (c != null && c.moveToNext()) {
          long id = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));
          int st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
          seen.add(id);
          JSONObject o = new JSONObject();
          o.put("id", id);
          o.put("state", st == DownloadManager.STATUS_SUCCESSFUL ? "done" : st == DownloadManager.STATUS_FAILED ? "failed" : "running");
          o.put("name", c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)));
          o.put("bytes", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)));
          o.put("total", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
          if (st == DownloadManager.STATUS_SUCCESSFUL) {
            o.put("uri", str(dm.getUriForDownloadedFile(id)));
            o.put("mime", str(dm.getMimeTypeForDownloadedFile(id)));
          }
          out.put(o);
        }
      } finally {
        if (c != null) c.close();
      }
      for (long id : ids) if (!seen.contains(id)) {
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("state", "gone");
        out.put(o);
      }
    } catch (Exception e) {
      android.util.Log.w("HubBrowser", "info", e);
    }
    return out.toString();
  }

  /** Removes a download: its file goes too (the Downloads page's delete). */
  void remove(long id, String uri) {
    if (id > 0) { dm.remove(id); active.remove(id); forget(String.valueOf(id)); return; }
    if (uri != null && !uri.isEmpty()) {
      try { ctx.getContentResolver().delete(Uri.parse(uri), null, null); } catch (Exception ignored) { }
      forget(uri);
    }
  }

  // ---------- what the Browser saved, for Settings' Storage ----------
  // The Browser's downloads (DownloadManager ids) and saved pictures (MediaStore uris) are remembered here, so the
  // size counts only what the Browser saved, not every download on the tablet.
  private static final String SAVED = "browserSaved";

  private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("hub", Context.MODE_PRIVATE); }

  private static Set<String> saved(Context c) {
    Set<String> s = prefs(c).getStringSet(SAVED, null);
    return s == null ? new HashSet<>() : new HashSet<>(s);
  }

  private void remember(String key) {
    Set<String> s = saved(ctx);
    if (s.add(key)) prefs(ctx).edit().putStringSet(SAVED, s).apply();
  }

  private void forget(String key) {
    Set<String> s = saved(ctx);
    if (s.remove(key)) prefs(ctx).edit().putStringSet(SAVED, s).apply();
  }

  /** {bytes, count}: the successful downloads and saved pictures the Browser made that are still on the tablet. */
  static String savedJson(Context c) throws Exception {
    Set<String> keys = saved(c);
    Set<String> keep = new HashSet<>();
    long bytes = 0;
    int count = 0;
    List<Long> ids = new ArrayList<>();
    for (String k : keys) {
      if (k.startsWith("content:")) continue;
      try { ids.add(Long.parseLong(k)); } catch (NumberFormatException ignored) { }
    }
    if (!ids.isEmpty()) {
      DownloadManager dm = (DownloadManager) c.getSystemService(Context.DOWNLOAD_SERVICE);
      long[] arr = new long[ids.size()];
      for (int i = 0; i < arr.length; i++) arr[i] = ids.get(i);
      Cursor cur = dm.query(new DownloadManager.Query().setFilterById(arr));
      try {
        while (cur != null && cur.moveToNext()) {
          long id = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));
          keep.add(String.valueOf(id));   // a download still listed (in progress, failed or done) is kept
          if (cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) != DownloadManager.STATUS_SUCCESSFUL) continue;
          long size = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
          if (size <= 0) size = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
          bytes += Math.max(0, size);
          count++;
        }
      } finally {
        if (cur != null) cur.close();
      }
    }
    for (String k : keys) {
      if (!k.startsWith("content:")) continue;
      try (AssetFileDescriptor afd = c.getContentResolver().openAssetFileDescriptor(Uri.parse(k), "r")) {
        bytes += afd == null ? 0 : Math.max(0, afd.getLength());
        count++;
        keep.add(k);
      } catch (Exception gone) {
        // deleted from the Downloads folder: not counted, and forgotten below
      }
    }
    if (!keep.equals(keys)) prefs(c).edit().putStringSet(SAVED, keep).apply();
    return new JSONObject().put("bytes", bytes).put("count", count).toString();
  }

  private static String str(Object o) { return o == null ? "" : o.toString(); }

  private static long[] toArray(Set<Long> s) {
    long[] a = new long[s.size()];
    int i = 0;
    for (long v : s) a[i++] = v;
    return a;
  }

  private static long[] parseIds(String csv) {
    if (csv == null || csv.trim().isEmpty()) return new long[0];
    String[] parts = csv.split(",");
    long[] out = new long[parts.length];
    int n = 0;
    for (String p : parts) {
      try { long v = Long.parseLong(p.trim()); if (v > 0) out[n++] = v; } catch (NumberFormatException ignored) { }
    }
    return java.util.Arrays.copyOf(out, n);
  }
}
