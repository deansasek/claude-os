package hub.kiosk;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * The whole app: one full-screen WebView showing the Hub server on the PC.
 *
 * - It is the tablet's home screen, so it opens at boot and Home always comes back here.
 * - As device owner it pins itself (lock task): no status bar, no navigation, no other apps,
 *   no lock screen, and the screen stays on while charging.
 * - The page talks to the tablet through window.HubDevice (see Bridge), and only when the page
 *   really is the Hub server.
 * - If the PC can't be reached it shows a small "looking for your PC" screen and keeps retrying.
 *
 * The server address can be changed from the PC:
 *   adb shell am start -n hub.kiosk/.MainActivity --es url http://<PC address>:8000/?device=tablet
 */
public class MainActivity extends Activity {
  static final String TAG = "HubKiosk";
  // the hub's address, from config.json (HubConfig is written by android/build.ts)
  static final String DEFAULT_URL = HubConfig.DEFAULT_URL;

  private static volatile MainActivity live;   // for Guard, in the same process
  private WebView web;
  private Bridge bridge;

  /** True while Claude Home is the resumed app but something (the pull-down) has taken its window focus. */
  static boolean shadeCovering() {
    MainActivity a = live;
    return a != null && a.inFront && !a.hasWindowFocus();
  }
  private volatile boolean inFront = false;   // set in onResume / onPause
  static boolean isInFront() { MainActivity a = live; return a != null && a.inFront; }

  /** Claude Home's background colour, for the strip over Android's status bar (the page sends it on theme changes). */
  static volatile int topColor = 0xFF141413;
  private static volatile boolean topColorKnown = false;
  /** Claude Home's background colour once the page has sent one (null before): Claude Keyboard follows its theme. */
  public static Integer claudeHomeColor() { return topColorKnown ? topColor : null; }
  static void setTopColor(int c) {
    topColor = c;
    topColorKnown = true;
    Guard.paintStrip(c);
    MainActivity a = live;
    if (a != null) a.runOnUiThread(a::hideBars);
  }
  /** Open Claude Home's own pull-down (Desk mode's edge strip calls this). */
  static void openPullDown() { shadeBlocked(); }

  /** Open Claude Home's app switcher (Desk mode's bottom strip calls this on a swipe up). */
  static void openSwitcher() {
    MainActivity a = live;
    if (a == null) return;
    a.runOnUiThread(() -> {
      a.hideBars();
      a.web.evaluateJavascript("window.hubSwitcher && window.hubSwitcher()", null);
    });
  }

  /** The bottom strip sits over the page: touches that aren't the swipe go on to the page (main thread). */
  static void forwardTouch(android.view.MotionEvent ev) {
    MainActivity a = live;
    if (a == null || a.web == null) return;
    int[] at = new int[2];
    a.web.getLocationOnScreen(at);
    android.view.MotionEvent copy = android.view.MotionEvent.obtain(ev);
    copy.setLocation(ev.getRawX() - at[0], ev.getRawY() - at[1]);
    try { a.web.dispatchTouchEvent(copy); } finally { copy.recycle(); }
  }

  /** Desk mode's helper just closed Android's pull-down: hide the bars again and open Claude Home's own. */
  static void shadeBlocked() {
    MainActivity a = live;
    if (a == null) return;
    a.runOnUiThread(() -> {
      a.hideBars();
      a.web.evaluateJavascript("window.hubPullDown && window.hubPullDown()", null);
    });
  }
  private String url;
  private View cover;                 // the cream cover over the page until it has loaded (see coverView)
  private boolean coverGone = false;
  private boolean showingOffline = false;
  private final Handler ui = new Handler(Looper.getMainLooper());

  @Override protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    SharedPreferences prefs = getSharedPreferences("hub", MODE_PRIVATE);
    String fromIntent = getIntent() != null ? getIntent().getStringExtra("url") : null;
    if (fromIntent != null && fromIntent.startsWith("http")) prefs.edit().putString("url", fromIntent).apply();
    url = prefs.getString("url", DEFAULT_URL);

    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    if (Build.VERSION.SDK_INT >= 28) {
      getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    }

    Kiosk.quietCrashes();    // a crash restarts ClaudeOS without Android's "has stopped" dialog
    lockdown();
    AdbWifi.reapply(this);   // wireless debugging the user keeps on comes back after a restart (AdbWifi.java)
    AdbWifi.watch(this);     // and after Wi-Fi changes networks
    hub.kiosk.ime.ImeSettings.ensureDefault(this);   // Claude Keyboard is the tablet's keyboard (when it may set that)

    // lets the PC inspect the page over adb (chrome://inspect); nothing else can reach it
    WebView.setWebContentsDebuggingEnabled(true);
    web = new WebView(this);
    web.setBackgroundColor(Color.parseColor("#F5F0E6"));
    web.setOverScrollMode(View.OVER_SCROLL_NEVER);
    web.setHapticFeedbackEnabled(false);
    web.setLongClickable(false);
    web.setOnLongClickListener(v -> true);   // no text-selection popups
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);   // chimes and alarms can sound without a tap first
    s.setTextZoom(100);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setGeolocationEnabled(true);   // only ever granted to the Hub page itself (WebChromeClient below)

    bridge = new Bridge(this, web);
    web.addJavascriptInterface(bridge, "HubDevice");
    VoiceService.sink = this::voiceEvent;   // voice: wake word, transcripts and speech, to window.hubVoice
    web.setWebViewClient(new Client());
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onConsoleMessage(ConsoleMessage m) {
        Log.d(TAG, "page: " + m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
        return true;
      }
      // The Hub page is ClaudeOS itself: the camera and microphone it asks for, and its location, are granted here
      // (only to the Hub's own address, and only the Android permission it already has). Nothing is asked.
      @Override public void onPermissionRequest(android.webkit.PermissionRequest r) {
        if (!isServer(r.getOrigin() == null ? null : r.getOrigin().toString())) { r.deny(); return; }
        java.util.List<String> ok = new java.util.ArrayList<>();
        for (String res : r.getResources()) {
          if (android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) && checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) ok.add(res);
          else if (android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) ok.add(res);
        }
        if (ok.isEmpty()) r.deny(); else r.grant(ok.toArray(new String[0]));
      }
      @Override public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback cb) {
        cb.invoke(origin, isServer(origin) && checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED, false);
      }
      // The Hub page has no file inputs; if one ever appears it gets no picker (Android's file chooser is never shown).
      @Override public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<android.net.Uri[]> cb, FileChooserParams p) {
        cb.onReceiveValue(null);
        return true;
      }
      // The Hub page never shows Android's dialogs: its alert/confirm/prompt are answered here, silently.
      @Override public boolean onJsAlert(WebView v, String u, String message, android.webkit.JsResult r) { r.confirm(); return true; }
      @Override public boolean onJsConfirm(WebView v, String u, String message, android.webkit.JsResult r) { r.cancel(); return true; }
      @Override public boolean onJsPrompt(WebView v, String u, String message, String def, android.webkit.JsPromptResult r) { r.cancel(); return true; }
      @Override public boolean onJsBeforeUnload(WebView v, String u, String message, android.webkit.JsResult r) { r.confirm(); return true; }
    });
    // escape hatch when the Hub page can't load: tap the "looking for your PC" screen 7 times quickly
    web.setOnTouchListener((v, ev) -> {
      if (showingOffline && ev.getActionMasked() == android.view.MotionEvent.ACTION_DOWN) {
        long now = System.currentTimeMillis();
        if (now - firstTap > 4000) { firstTap = now; taps = 0; }
        if (++taps >= 7) { taps = 0; maintenance(); }
      }
      return false;
    });
    // the page sits under a cream cover (the spark) until it has loaded: no white flash, no Android showing through
    FrameLayout root = new FrameLayout(this);
    root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    cover = coverView();
    root.addView(cover, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    setContentView(root);
    if (Build.VERSION.SDK_INT >= 30) root.setOnApplyWindowInsetsListener(this::keepPageSizeFromKeyboard);
    excludeSideEdges(root);   // no Android back arrow on a swipe in from the left or right edge (sideBackGestureOff)
    new BrowserView(this, root, web);   // the Browser app's native pages, laid over the content area (BrowserView.java)
    BrowserView.fromIntent(getIntent());   // a web link that opened Claude Home from another app (default browser)
    ui.postDelayed(this::hideCover, 12_000);   // never leave the cover up for good
    loadHub();
    ui.postDelayed(this::updateTick, 20_000);  // silent self-update: a check soon after start, then every 30 minutes
  }

  /** Cream with the spark, the same as the splash screen before it. */
  private View coverView() {
    FrameLayout f = new FrameLayout(this);
    f.setBackgroundColor(getColor(R.color.splash_background));
    ImageView spark = new ImageView(this);
    spark.setImageResource(R.drawable.splash_spark);
    int px = Math.round(160 * getResources().getDisplayMetrics().density);
    f.addView(spark, new FrameLayout.LayoutParams(px, px, Gravity.CENTER));
    return f;
  }

  /** Fade the cover away: the page has loaded (or the offline screen is up). */
  private void hideCover() {
    if (coverGone || cover == null) return;
    coverGone = true;
    cover.animate().alpha(0f).setDuration(450).withEndAction(() -> cover.setVisibility(View.GONE)).start();
  }

  /** The Hub server's address as the page was loaded from, e.g. http://192.168.1.20:8000 */
  String serverOrigin() {
    Uri b = Uri.parse(url);
    return b.getScheme() + "://" + b.getAuthority();
  }

  private static final long UPDATE_EVERY_MS = 30 * 60_000L;
  /** As device owner, look for a newer build on the Hub server (Updater installs it silently). */
  private void updateTick() {
    if (isOwner()) new Thread(() -> Updater.check(this, serverOrigin())).start();
    ui.postDelayed(this::updateTick, UPDATE_EVERY_MS);
  }

  private long firstTap = 0;
  private int taps = 0;

  // ---------- which pages may use the bridge ----------
  boolean isServer(String u) {
    if (u == null) return false;
    Uri a = Uri.parse(u), b = Uri.parse(url);
    return "http".equals(a.getScheme()) && a.getHost() != null && a.getHost().equals(b.getHost()) && a.getPort() == b.getPort();
  }

  private class Client extends WebViewClient {
    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
      return !isServer(r.getUrl().toString());   // never wander off the Hub
    }
    /** Plain http from the Hub's page: only to the Hub or a home-network address (public http is refused). */
    @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
      Uri u = r.getUrl();
      if (u == null || !"http".equalsIgnoreCase(u.getScheme()) || isServer(u.toString()) || BrowserView.isLocalHost(u.getHost())) return null;
      return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", java.util.Collections.<String, String>emptyMap(),
          new java.io.ByteArrayInputStream(new byte[0]));
    }
    @Override public void onPageStarted(WebView v, String u, android.graphics.Bitmap icon) {
      bridge.setAllowed(isServer(u));
    }
    @Override public void onPageFinished(WebView v, String u) {
      hideCover();
      v.evaluateJavascript("innerWidth+'x'+innerHeight+' dpr '+devicePixelRatio+' screen '+screen.width+'x'+screen.height",
          r -> Log.i(TAG, "viewport " + r));
    }
    @Override public void doUpdateVisitedHistory(WebView v, String u, boolean reload) {
      bridge.setAllowed(isServer(u));
    }
    @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
      if (r.isForMainFrame()) showOffline();
    }
    @Override public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse resp) {
      if (r.isForMainFrame() && resp.getStatusCode() >= 500) showOffline();
    }
    /** The page's renderer died: reload quietly instead of letting Android show "has stopped". */
    @Override public boolean onRenderProcessGone(WebView v, android.webkit.RenderProcessGoneDetail d) {
      Log.w(TAG, "page renderer gone; reloading");
      ui.post(MainActivity.this::loadHub);
      return true;
    }
  }

  // ---------- when the PC isn't there ----------
  /** ClaudeOS's own calm screen for when the PC can't be reached or the page won't start (cream, the Claude mark). */
  private static String screen(String title, String line, String line2) {
    return "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
    + "<style>html,body{margin:0;height:100%;background:#F5F0E6;color:#141413;font-family:Georgia,serif;display:flex;"
    + "align-items:center;justify-content:center;text-align:center}h1{font-weight:400;font-size:34px;margin:24px 0 8px}"
    + "p{font:15px sans-serif;color:#5e5d59;margin:4px}svg{animation:b 2.4s ease-in-out infinite}"
    + "@media (prefers-reduced-motion:reduce){svg{animation:none}}@keyframes b{50%{transform:translateY(-6px)}}</style>"
    + "<div><svg width=112 height=88 viewBox='0 0 14 11' shape-rendering=crispEdges>"
    + "<g fill='#B85C3E'><rect x=3 y=7 width=1 height=2.6 /><rect x=5 y=7 width=1 height=2.6 /><rect x=8 y=7 width=1 height=2.6 /><rect x=10 y=7 width=1 height=2.6 /></g>"
    + "<rect x=1 y=4 width=1.2 height=2 fill='#D97757'/><rect x=11.8 y=4 width=1.2 height=2 fill='#D97757'/>"
    + "<rect x=2 y=1.5 width=10 height=6 fill='#D97757'/><g fill='#141413'><rect x=4 y=3 width=1 height=2 /><rect x=9 y=3 width=1 height=2 /></g></svg>"
    + "<h1>" + title + "</h1><p>" + line + "</p>" + (line2 == null ? "" : "<p>" + line2 + "</p>")
    + "<p style='margin-top:28px;font-size:12px;color:#8a8984'>Tap 7 times quickly for the tablet's settings.</p></div>";
  }

  // ---------- the Hub page must say it has started ----------
  /** How long the Hub page may take to say it has started (Bridge.booted), before the shell reloads it. */
  private static final long BOOT_WATCH_MS = 20_000;
  private int bootFails = 0;
  private final Runnable bootTimedOut = this::onBootTimedOut;

  /** Load the Hub page and start the watch for it to say it has started. Every load of the Hub goes through here. */
  void loadHub() {
    showingOffline = false;
    ui.removeCallbacks(bootTimedOut);
    ui.postDelayed(bootTimedOut, BOOT_WATCH_MS);
    web.loadUrl(url);
  }

  /** The Hub page has started (Bridge.booted): stop watching, and forget the failed tries. */
  void pageBooted() {
    ui.post(() -> { ui.removeCallbacks(bootTimedOut); bootFails = 0; });
  }

  /** The page never said it had started: show ClaudeOS's own screen, and reload the Hub after a backoff (3s, 6s, 12s, then 30s). */
  private void onBootTimedOut() {
    if (showingOffline) return;   // the offline screen is up; the probe brings the Hub back when the PC answers
    bootFails++;
    Log.w(TAG, "the Hub page did not start within " + (BOOT_WATCH_MS / 1000) + "s; reloading (try " + bootFails + ")");
    showingOffline = true;        // so the 7-tap escape to Android's settings still works on this screen
    bridge.setAllowed(false);
    web.loadDataWithBaseURL(null, screen("ClaudeOS", "Something didn't load. Trying again…", null), "text/html", "utf-8", null);
    long wait = bootFails == 1 ? 3_000 : bootFails == 2 ? 6_000 : bootFails == 3 ? 12_000 : 30_000;
    ui.postDelayed(this::loadHub, wait);
  }

  // ---------- when the PC isn't there ----------
  private void showOffline() {
    if (showingOffline) return;
    showingOffline = true;
    ui.removeCallbacks(bootTimedOut);
    bridge.setAllowed(false);
    web.loadDataWithBaseURL(null, screen("Can't reach your PC", "ClaudeOS runs on your PC, and it isn’t answering yet.",
        "This screen will connect on its own as soon as it is."), "text/html", "utf-8", null);
    ui.postDelayed(this::probe, 4000);
  }

  /** Ask the server if it's back; load the Hub when it is. */
  private void probe() {
    new Thread(() -> {
      boolean up = false;
      try {
        Uri b = Uri.parse(url);
        HttpURLConnection c = (HttpURLConnection) new URL(b.getScheme() + "://" + b.getAuthority() + "/api/core/version").openConnection();
        c.setConnectTimeout(3000); c.setReadTimeout(3000);
        up = c.getResponseCode() == 200;
        c.disconnect();
      } catch (Exception ignored) { }
      final boolean ok = up;
      ui.post(() -> {
        if (!showingOffline) return;   // the Hub was loaded some other way meanwhile
        if (ok) loadHub();
        else ui.postDelayed(this::probe, 5000);
      });
    }).start();
  }

  // ---------- kiosk ----------
  DevicePolicyManager dpm() { return (DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE); }
  boolean isOwner() { return dpm().isDeviceOwnerApp(getPackageName()); }

  /**
   * As device owner: pin this app, be the home screen, no lock screen, no status bar, stay awake on power, and the
   * Desk mode setup done silently (every start, and every time ClaudeOS comes back to the front). No Android screen
   * opens for any of it: permissions are granted here and no runtime prompt is ever shown.
   */
  void lockdown() {
    if (!isOwner()) return;
    DevicePolicyManager d = dpm();
    ComponentName admin = AdminReceiver.component(this);
    try {
      Launcher.applyLockTask(this);   // Claude Home plus the allowed Android apps, so they stay permitted
      applyLockTaskFeatures();
      IntentFilter home = new IntentFilter(Intent.ACTION_MAIN);
      home.addCategory(Intent.CATEGORY_HOME);
      home.addCategory(Intent.CATEGORY_DEFAULT);
      d.addPersistentPreferredActivity(admin, home, new ComponentName(this, MainActivity.class));   // the home screen: no role prompt
      boolean keyguardOff = d.setKeyguardDisabled(admin, true);                                     // no lock screen, no password screen
      getSharedPreferences("hub", MODE_PRIVATE).edit().putBoolean("keyguardOff", keyguardOff).apply();
      boolean sb = d.setStatusBarDisabled(admin, true);
      if (!sb) Log.w(TAG, "setStatusBarDisabled refused");
      d.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7");   // AC, USB and wireless: stay awake
      if (Build.VERSION.SDK_INT >= 30) d.setLocationEnabled(admin, true);           // Android only lists Wi-Fi networks with Location on
      // every runtime permission ClaudeOS uses is granted outright, so ClaudeOS itself never prompts
      String[] perms = {
          "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION",
          "android.permission.CAMERA", "android.permission.RECORD_AUDIO",
          "android.permission.BLUETOOTH_CONNECT", "android.permission.NEARBY_WIFI_DEVICES", "android.permission.POST_NOTIFICATIONS",
          "android.permission.GET_ACCOUNTS",
      };
      for (String p : perms) {
        try {
          // already granted: no new grant, so Android's "ClaudeOS has ... access" notice is not posted again
          if (checkSelfPermission(p) == android.content.pm.PackageManager.PERMISSION_GRANTED) continue;
          d.setPermissionGrantState(admin, getPackageName(), p, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
        }
        catch (IllegalArgumentException e) { Log.w(TAG, "grant " + p + " not declared here"); }   // e.g. NEARBY_WIFI_DEVICES before Android 13
        catch (RuntimeException e) { Log.w(TAG, "grant " + p, e); }
      }
      // Android UI that can otherwise surface on the tablet, removed as device owner (each one logged, none fatal):
      // crash and "isn't responding" dialogs, and booting into Safe mode (the Android label and menus).
      // Not set: anything that could block adb, debugging, or factory reset.
      for (String restriction : new String[] {"no_system_error_dialogs", "no_safe_boot"}) {
        try { d.addUserRestriction(admin, restriction); }
        catch (RuntimeException e) { Log.w(TAG, "restriction " + restriction, e); }
      }
      // System updates install only in the night window (02:00 to 04:00), never as a prompt during the day.
      try { d.setSystemUpdatePolicy(admin, android.app.admin.SystemUpdatePolicy.createWindowedInstallPolicy(120, 240)); }
      catch (RuntimeException e) { Log.w(TAG, "system update policy", e); }
      // Device-wide policy: back to Android's default (prompt). Reverts AUTO_GRANT if an earlier build set it.
      // ClaudeOS itself never prompts: its own permissions are granted per permission above.
      try { d.setPermissionPolicy(admin, DevicePolicyManager.PERMISSION_POLICY_PROMPT); }
      catch (RuntimeException e) { Log.w(TAG, "permission policy", e); }
      taskbarHidden(true);                                    // no stock dock on a swipe up (taskbarHidden)
      Kiosk.ownerSetup(this, d, admin);                       // Desk mode's helper on, and only Claude Keyboard allowed
      hub.kiosk.ime.ImeSettings.ensureDefault(this);          // Claude Keyboard as the default keyboard
    } catch (Exception e) {
      Log.w(TAG, "lockdown", e);
    }
  }

  /** True while Google sign-in's Chrome side sheet is open beside the hub (BrowserView.launchChrome / endChrome). */
  private static volatile boolean chromeSheetOpen = false;

  /** True from just before an allowed Android app is started from here, until Claude Home resumes (allowedAppOpening). */
  private static volatile boolean allowedAppFront = false;

  /**
   * Lock task's features, as device owner. NONE whenever Claude Home is in front: no home handle, no recents, no
   * notifications, no system info, no power menu. LOCK_TASK_FEATURE_HOME is what makes Android draw the navigation
   * bar and home handle over the pinned task, so it must not be set while Claude Home is up. It is set only while an
   * allowed app is in front (allowedAppOpening), so that app's home gesture can bring Claude Home back; onResume
   * puts NONE back. The Chrome sheet is always NONE (the hub is beside it).
   */
  private void applyLockTaskFeatures() {
    if (!isOwner()) return;
    boolean home = allowedAppFront && !chromeSheetOpen;
    try {
      dpm().setLockTaskFeatures(AdminReceiver.component(this),
          home ? DevicePolicyManager.LOCK_TASK_FEATURE_HOME : DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
    } catch (Exception e) { Log.w(TAG, "lock task features", e); }
  }

  /** Called just before an allowed Android app is started (Launcher.launch, openAndroid); pass false if it didn't start. */
  static void allowedAppOpening(boolean on) {
    allowedAppFront = on;
    MainActivity a = live;
    if (a != null) a.applyLockTaskFeatures();
  }

  /** True from allowedAppOpening(true) until Claude Home resumes: an allowed Android app is in front (BackButton). */
  static boolean allowedAppInFront() { return allowedAppFront; }

  /**
   * The Chrome sign-in sheet opens (true) or has closed (false). Android takes the system bars' visibility from the
   * focused window, except when that window can't be a full-screen one (a partial Custom Tab can't): then it uses
   * the top full-screen window's request, which is Claude Home's (InsetsPolicy.getStatusControlTarget). So the
   * bars stay hidden beside the sheet only if Claude Home itself asks for them hidden, all of them, before Chrome
   * takes focus: hideBars() does that while the sheet is open, also in Desk mode (the strip goes away meanwhile).
   */
  void chromeSheet(boolean open) {
    chromeSheetOpen = open;
    applyLockTaskFeatures();
    hideBars();
  }

  private void pin() {
    if (!isOwner() || !dpm().isLockTaskPermitted(getPackageName())) return;
    ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
    if (am.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_NONE) {
      try { startLockTask(); } catch (Exception e) { Log.w(TAG, "startLockTask", e); }
    }
  }

  boolean isPinned() {
    ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
    return am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
  }

  /**
   * Recovery: unpin and open Android's Settings, with Android's Taskbar and its gestures back (taskbarHidden), so
   * the device can always be driven the stock way from here. Coming back Home pins it again and hides the Taskbar.
   */
  void maintenance() {
    taskbarHidden(false);
    openAndroid(new Intent(Settings.ACTION_SETTINGS));
  }

  /**
   * The package that draws Android's Taskbar (the white dock) and the stock bottom-edge gestures: the system's
   * recents component (config_recentsComponentName; Launcher3 Quickstep on this tablet). Null if it can't be found
   * or is one that must never be hidden.
   */
  private String taskbarPackage() {
    String pkg = "com.android.launcher3";
    try {
      int id = android.content.res.Resources.getSystem().getIdentifier("config_recentsComponentName", "string", "android");
      ComponentName cn = id > 0 ? ComponentName.unflattenFromString(android.content.res.Resources.getSystem().getString(id)) : null;
      if (cn != null) pkg = cn.getPackageName();
    } catch (Exception e) { Log.w(TAG, "recents component", e); }
    if (pkg.equals(getPackageName()) || pkg.equals("android") || pkg.equals("com.android.systemui")) return null;
    return pkg;
  }

  /**
   * As device owner, hide (true) or bring back (false) the Taskbar's package (taskbarPackage).
   *
   * Why: with gesture navigation the bottom edge belongs to Launcher's Taskbar window. A swipe up there makes
   * Android show the navigation bar over Claude Home (DisplayPolicy.requestTransientBars); that bar is the
   * Taskbar, and Launcher can leave it unstashed, so the full white dock slides in. Hiding the bars again
   * afterwards (rehide) is too late: the dock is already on screen. With the package hidden there is no Taskbar
   * window, so no bottom gesture host and nothing to show, and the swipe reaches the page (switcher.ts).
   *
   * Inside Claude Home nothing is lost: lock task (LOCK_TASK_FEATURE_NONE) already turns off Android's home and
   * recents. An allowed app is left with BackButton. The back gesture stays (it is SystemUI's, not Launcher's).
   * maintenance() brings the package back for the stock Settings path; lockdown() hides it again on return.
   * The package stays installed: hidden only, and undone by this call with false.
   */
  void taskbarHidden(boolean hide) {
    if (!isOwner()) return;
    String pkg = taskbarPackage();
    if (pkg == null) return;
    ComponentName admin = AdminReceiver.component(this);
    try {
      if (dpm().isApplicationHidden(admin, pkg) == hide) return;
      boolean ok = dpm().setApplicationHidden(admin, pkg, hide);
      trace("taskbar " + pkg + (hide ? " hidden" : " shown") + (ok ? "" : " (refused)"));
    } catch (RuntimeException e) { Log.w(TAG, "taskbar hidden " + hide, e); }
  }

  /**
   * Open one of Android's own screens. An app on the lock task allowlist (Launcher.lockAllowed) opens inside the
   * pinned task: no unpin, the status bar stays off. Anything else (Settings, the Wi-Fi panel, ...) unpins first and
   * lets the guard stand down until the Hub is back in front.
   */
  void openAndroid(Intent i) {
    String pkg = i.getComponent() != null ? i.getComponent().getPackageName() : i.getPackage();
    if (Launcher.lockAllowed(this, pkg)) {
      boolean other = !getPackageName().equals(pkg);
      if (other) allowedAppOpening(true);
      try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
      catch (Exception e) { Log.w(TAG, "open " + i, e); if (other) allowedAppOpening(false); }
      return;
    }
    Kiosk.pause(15 * 60_000L);
    try { stopLockTask(); } catch (Exception ignored) { }
    if (isOwner()) {
      try { dpm().setStatusBarDisabled(AdminReceiver.component(this), false); } catch (Exception ignored) { }
    }
    try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
    catch (Exception e) { Log.w(TAG, "open " + i, e); Kiosk.resume(); }
  }

  /** Ask Android to make the Hub the home screen (a system prompt). */
  void requestHomeRole() {
    Kiosk.pause(5 * 60_000L);
    android.app.role.RoleManager rm = getSystemService(android.app.role.RoleManager.class);
    if (rm != null && rm.isRoleAvailable(android.app.role.RoleManager.ROLE_HOME) && !rm.isRoleHeld(android.app.role.RoleManager.ROLE_HOME)) {
      startActivityForResult(rm.createRequestRoleIntent(android.app.role.RoleManager.ROLE_HOME), 41);
    }
  }

  void requestWifiPermissions() {
    Kiosk.pause(5 * 60_000L);
    requestPermissions(Build.VERSION.SDK_INT >= 33
        ? new String[] { "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION", "android.permission.NEARBY_WIFI_DEVICES" }
        : new String[] { "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION" }, 42);
  }

  /**
   * True in Desk mode (not device owner, helper connected): the status bar is kept showing under the helper's
   * strip on purpose. Everywhere else (device owner, the Chrome sheet, no helper) the bars must stay hidden.
   */
  private boolean barsCovered() {
    return !isOwner() && Guard.connected && Kiosk.enabled(this) && !chromeSheetOpen;
  }

  /** Claude Home is in front and the bars are meant to be hidden (see barsCovered). */
  private boolean barsShouldBeHidden() {
    return inFront && !barsCovered();
  }

  // ---------- diagnostics: logcat is silenced on this tablet (persist.log.tag=S...), so keep a ring buffer ----------
  // Read it with: adb shell dumpsys activity activity hub.kiosk/.MainActivity   (section "ClaudeOS bars")
  private static final java.util.ArrayDeque<String> barTrace = new java.util.ArrayDeque<>();
  static void trace(String s) {
    synchronized (barTrace) {
      barTrace.addFirst(android.os.SystemClock.uptimeMillis() + " " + s);
      while (barTrace.size() > 60) barTrace.removeLast();
    }
  }

  @Override public void dump(String prefix, java.io.FileDescriptor fd, java.io.PrintWriter w, String[] args) {
    super.dump(prefix, fd, w, args);
    w.println(prefix + "ClaudeOS bars: inFront=" + inFront + " owner=" + isOwner() + " covered=" + barsCovered()
        + " chromeSheet=" + chromeSheetOpen + " showing=" + barNames(barsShowing()) + " topBandPx=" + topBandPx + " bottomBandPx=" + bottomBandPx
        + " now="+ android.os.SystemClock.uptimeMillis());
    synchronized (barTrace) { for (String s : barTrace) w.println(prefix + "  " + s); }
  }

  /** Which of the status and navigation bars are on screen over Claude Home right now (WindowInsets types). */
  private int barsShowing() {
    if (Build.VERSION.SDK_INT < 30) return 0;
    WindowInsets in = getWindow().getDecorView().getRootWindowInsets();
    if (in == null) return 0;
    int s = 0;
    // one type at a time: isVisible(a | b) is true only when ALL of them are visible
    if (in.isVisible(WindowInsets.Type.statusBars())) s |= WindowInsets.Type.statusBars();
    if (in.isVisible(WindowInsets.Type.navigationBars())) s |= WindowInsets.Type.navigationBars();
    return s;
  }
  private static String barNames(int t) {
    if (Build.VERSION.SDK_INT < 30 || t == 0) return "none";
    return ((t & WindowInsets.Type.statusBars()) != 0 ? "status " : "") + ((t & WindowInsets.Type.navigationBars()) != 0 ? "nav" : "");
  }

  private static final long REHIDE_DELAY_MS = 150;   // at most one re-hide per this many ms (loop guard)
  private static final long REHIDE_CHECK_MS = 350;   // after a hide, look again once its animation has had time to end
  private static final int REHIDE_TRIES = 12;        // then give up until the next inset change (about 4 s)
  private boolean rehidePending = false;
  private long lastRehideAt = 0;
  private int rehideTries = 0;
  private final Runnable rehideNow = this::rehide;
  private void rehide() {
    rehidePending = false;
    lastRehideAt = System.currentTimeMillis();
    if (!barsShouldBeHidden() || Build.VERSION.SDK_INT < 30) { rehideTries = 0; return; }
    int showing = barsShowing();
    if (showing == 0) { if (rehideTries > 0) trace("rehide: bars gone after " + rehideTries); rehideTries = 0; return; }
    rehideTries++;
    trace("rehide try " + rehideTries + ": showing " + barNames(showing));
    if (rehideTries >= 3) hideBars();   // a plain hide didn't take: put the whole setup back (behaviour, flags, hide)
    else {
      WindowInsetsController c = getWindow().getInsetsController();
      if (c != null) c.hide(WindowInsets.Type.systemBars());   // the behaviour is already set by hideBars()
    }
    // a hide can be undone or ignored (the swipe's touch is still held by Android's status bar): check again
    if (rehideTries < REHIDE_TRIES) { rehidePending = true; ui.postDelayed(rehideNow, REHIDE_CHECK_MS); }
    else { trace("rehide: still showing " + barNames(barsShowing()) + ", gave up"); rehideTries = 0; }
  }

  /**
   * Something showed a bar over Claude Home (a top-edge swipe reveal, a focus change, the keyboard, a dialog):
   * hide it again shortly, and keep checking until both bars really are gone. Calls while one is pending merge.
   */
  void scheduleRehide() {
    if (rehidePending) return;
    rehidePending = true;
    long wait = Math.max(0, lastRehideAt + REHIDE_DELAY_MS - System.currentTimeMillis());
    ui.postDelayed(rehideNow, wait);
  }

  // ---------- Android's top gesture band ----------
  /**
   * Device px at the top of the screen where Android watches for its swipe-down (the status bar's height, its
   * mandatory gesture inset, or the system's gesture start threshold, whichever is largest, plus a little).
   * A quick swipe that starts here is taken by Android: with BEHAVIOR_DEFAULT it asks this window to show the
   * bars and moves the touch to its status bar window (DisplayPolicy.requestTransientBars, transferTouch), so
   * the page gets a cancel. The page puts its pull-down handle below this (Bridge.topGestureInset).
   */
  private static volatile int topBandPx = 0;
  static int topBandPx() { return topBandPx; }
  private void measureTopBand(WindowInsets in) {
    if (Build.VERSION.SDK_INT < 30 || in == null) return;
    int band = Math.max(in.getInsetsIgnoringVisibility(WindowInsets.Type.statusBars()).top,
        in.getInsets(WindowInsets.Type.mandatorySystemGestures()).top);
    int id = getResources().getIdentifier("system_gestures_start_threshold", "dimen", "android");
    if (id > 0) { try { band = Math.max(band, getResources().getDimensionPixelSize(id)); } catch (Exception ignored) { } }
    if (band > 0) band += Math.round(2 * getResources().getDisplayMetrics().density);
    if (band != topBandPx) { topBandPx = band; trace("top band " + band + "px"); }
  }

  /**
   * Device px at the bottom of the screen where Android watches for its swipe up (the navigation bar's height or its
   * mandatory gesture inset, whichever is larger, plus a little). As at the top, a swipe up that starts here is taken
   * by Android's gesture host (Taskbar), so the page gets a cancel. The page puts the switcher's handle above this
   * (Bridge.bottomGestureInset). With the Taskbar hidden (taskbarHidden) there is no such band: it measures 0 and
   * the page gets the whole swipe.
   */
  private static volatile int bottomBandPx = 0;
  static int bottomBandPx() { return bottomBandPx; }
  private void measureBottomBand(WindowInsets in) {
    if (Build.VERSION.SDK_INT < 30 || in == null) return;
    int band = Math.max(in.getInsetsIgnoringVisibility(WindowInsets.Type.navigationBars()).bottom,
        in.getInsets(WindowInsets.Type.mandatorySystemGestures()).bottom);
    if (band > 0) band += Math.round(2 * getResources().getDisplayMetrics().density);
    if (band != bottomBandPx) { bottomBandPx = band; trace("bottom band " + band + "px"); }
  }

  /** The top edge's touch, from ACTION_DOWN until it ends; -1 when the gesture didn't start in the band. */
  private float edgeDownY = -1;
  /** The bottom edge's touch: true when it started in the bottom band (measureBottomBand). */
  private boolean edgeDownBottom = false;

  /**
   * A swipe from the very top edge (down) or the very bottom edge (up): Android takes the touch (the page gets a
   * cancel) and shows its bars. Here the top becomes Claude Home's own pull-down, the bottom its app switcher
   * (window.hubSwipeUp); the bars are hidden again straight away.
   */
  @Override public boolean dispatchTouchEvent(android.view.MotionEvent ev) {
    if (sideSwipe(ev)) return true;   // a swipe in from the left or right edge: ClaudeOS's Back (sideSwipe)
    int act = ev.getActionMasked();
    if (act == android.view.MotionEvent.ACTION_DOWN) {
      float y = ev.getRawY();
      edgeDownY = topBandPx > 0 && y <= topBandPx && barsShouldBeHidden() ? y : -1;
      edgeDownBottom = bottomBandPx > 0 && y >= getResources().getDisplayMetrics().heightPixels - bottomBandPx && barsShouldBeHidden();
    } else if (act == android.view.MotionEvent.ACTION_CANCEL && (edgeDownY >= 0 || edgeDownBottom)) {
      boolean bottom = edgeDownBottom;
      if (bottom) trace("bottom edge swipe taken by Android: app switcher");
      else trace("edge swipe from y=" + Math.round(edgeDownY) + " taken by Android: our pull-down");
      edgeDownY = -1;
      edgeDownBottom = false;
      boolean r = super.dispatchTouchEvent(ev);   // the page sees its cancel first
      hideBars();
      scheduleRehide();
      String call = bottom ? "window.hubSwipeUp && window.hubSwipeUp()" : "window.hubPullDown && window.hubPullDown()";
      if (bridge != null && bridge.isAllowed()) ui.postDelayed(() -> web.evaluateJavascript(call, null), 30);
      return r;
    } else if (act == android.view.MotionEvent.ACTION_UP || act == android.view.MotionEvent.ACTION_CANCEL) {
      edgeDownY = -1;
      edgeDownBottom = false;
    }
    return super.dispatchTouchEvent(ev);
  }

  // ---------- Android's side back gesture: off over ClaudeOS, ClaudeOS's own edge swipe instead ----------
  /** Settings.Secure keys that scale SystemUI's back gesture strip on each side (1 by default; 0: no strip). */
  private static final String[] BACK_INSET_KEYS = { "back_gesture_inset_scale_left", "back_gesture_inset_scale_right" };

  /**
   * Turn Android's side back gesture off (true, onResume) or back on (false, onPause).
   *
   * Why: with gesture navigation a swipe in from the left or right edge makes SystemUI draw its round back arrow
   * over the page (EdgeBackGestureHandler). Gesture exclusion (excludeSideEdges) cannot stop that on its own:
   * Android honours only the lowest 200dp of each edge (system_gesture_exclusion_limit_dp), 150 px of the 800 px
   * on this tablet. The limit is lifted only for a window that hides the navigation bar with
   * BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE, and Claude Home uses BEHAVIOR_DEFAULT (hideBars). With the strip scaled
   * to 0, SystemUI starts no back gesture and draws no arrow; sideSwipe gives the swipe to ClaudeOS's Back instead.
   *
   * Needs WRITE_SECURE_SETTINGS (granted once from the PC, as for AdbWifi); without it only excludeSideEdges
   * applies. The scale that was set before is kept in prefs and put back when another app or maintenance()'s
   * Settings comes to the front (onPause), so Android's own back gesture works there.
   */
  private void sideBackGestureOff(boolean off) {
    if (checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
    android.content.ContentResolver r = getContentResolver();
    SharedPreferences p = getSharedPreferences("hub", MODE_PRIVATE);
    for (String k : BACK_INSET_KEYS) {
      try {
        String now = Settings.Secure.getString(r, k);
        if (off == "0".equals(now)) continue;   // already as wanted
        if (off) {
          p.edit().putString("saved_" + k, now == null ? "" : now).apply();
          Settings.Secure.putString(r, k, "0");
        } else {
          String saved = p.getString("saved_" + k, "");
          Settings.Secure.putString(r, k, saved.isEmpty() || saved.equals("0") ? null : saved);   // null: Android's default
        }
        trace("side back gesture " + k + (off ? " off" : " on"));
      } catch (RuntimeException e) { Log.w(TAG, "side back gesture " + k, e); }
    }
  }

  /** Device px of each side strip where a swipe in is Back: Android's own back strip width, at least 20dp. */
  private int sideStripPx() {
    float d = getResources().getDisplayMetrics().density;
    int px = Math.round(20 * d);
    int id = getResources().getIdentifier("config_backGestureInset", "dimen", "android");
    if (id > 0) { try { px = Math.max(px, getResources().getDimensionPixelSize(id)); } catch (Exception ignored) { } }
    return px;
  }

  /**
   * Keep the left and right edge strips of the page, full height, from Android's back gesture. Android honours
   * only the lowest 200dp of each edge (see sideBackGestureOff), so this is the fallback when the setting can't be
   * written, and it also covers the edge's outermost pixel there.
   */
  private void excludeSideEdges(View root) {
    if (Build.VERSION.SDK_INT < 29) return;
    root.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
      int w = r - l, h = b - t, strip = sideStripPx();
      v.setSystemGestureExclusionRects(java.util.Arrays.asList(
          new android.graphics.Rect(0, 0, strip, h), new android.graphics.Rect(w - strip, 0, w, h)));
    });
  }

  /** A touch that began in a side strip (sideSwipe): where it began, -1 when none. */
  private float sideDownX = -1, sideDownY = 0;
  private boolean sideFromLeft = false, sideTaken = false;

  /**
   * ClaudeOS's own back swipe, in place of Android's (sideBackGestureOff): a one-finger swipe that starts in the
   * left or right strip (sideStripPx) and moves inwards, mostly sideways. Once it has moved 24dp the page gets a
   * cancel and the rest of the touch is ours (as Android's gesture took it before); on release past 40dp it is
   * Back (goBack). True when the event is used here.
   */
  private boolean sideSwipe(android.view.MotionEvent ev) {
    int act = ev.getActionMasked();
    float d = getResources().getDisplayMetrics().density;
    if (act == android.view.MotionEvent.ACTION_DOWN) {
      float x = ev.getRawX();
      int strip = sideStripPx(), w = getResources().getDisplayMetrics().widthPixels;
      sideTaken = false;
      sideFromLeft = x <= strip;
      sideDownX = sideFromLeft || x >= w - strip ? x : -1;
      sideDownY = ev.getRawY();
      return false;
    }
    if (sideDownX < 0) return false;
    if (act == android.view.MotionEvent.ACTION_POINTER_DOWN && !sideTaken) { sideDownX = -1; return false; }   // two fingers: not Back
    float in = (ev.getRawX() - sideDownX) * (sideFromLeft ? 1 : -1), dy = Math.abs(ev.getRawY() - sideDownY);
    if (act == android.view.MotionEvent.ACTION_MOVE && !sideTaken && in > 24 * d && in > 2 * dy) {
      sideTaken = true;
      edgeDownY = -1;            // the top and bottom edge swipes (dispatchTouchEvent) don't apply to this touch
      edgeDownBottom = false;
      android.view.MotionEvent c = android.view.MotionEvent.obtain(ev);
      c.setAction(android.view.MotionEvent.ACTION_CANCEL);
      try { super.dispatchTouchEvent(c); } finally { c.recycle(); }   // the page lets go of the touch
    }
    if (act == android.view.MotionEvent.ACTION_UP || act == android.view.MotionEvent.ACTION_CANCEL) {
      boolean taken = sideTaken, back = taken && act == android.view.MotionEvent.ACTION_UP && in > 40 * d;
      sideDownX = -1;
      sideTaken = false;
      if (back) { trace("side swipe: back"); goBack(); }
      return taken;
    }
    return sideTaken;
  }

  /**
   * With Desk mode's helper running, Android's status bar stays put under the helper's strip (painted in
   * Claude Home's colours): a bar that's already showing can't flash in on a swipe, and the strip takes
   * its touches, so Android's pull-down can't open. Without the helper, hide everything (full screen).
   */
  private void hideBars() {
    if (Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController c = getWindow().getInsetsController();
      if (c != null) {
        // device owner: the status bar is off by policy, hide all. The Chrome sheet: hide all too (chromeSheet)
        boolean covered = barsCovered();
        // draw edge to edge either way: the page fills the whole screen and the strip sits on top of it
        getWindow().setDecorFitsSystemWindows(false);
        // if a bar is ever shown over Claude Home (swiped in), it is see-through over the page, not a black band
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
          getWindow().setStatusBarContrastEnforced(false);
          getWindow().setNavigationBarContrastEnforced(false);
        }
        boolean light = claudeHomeColor() == null || Color.luminance(topColor) >= 0.5f;   // dark icons on the cream page
        int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
        c.setSystemBarsAppearance(light ? lightBars : 0, lightBars);
        // Owner: BEHAVIOR_DEFAULT, so a swipe asks this window to show the bars and we stay their control target;
        // the insets listener then re-hides them (scheduleRehide). With TRANSIENT the system took control on a swipe
        // and our hide() calls did nothing. Desk mode keeps TRANSIENT (its strip takes the swipe).
        c.setSystemBarsBehavior(covered ? WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE : WindowInsetsController.BEHAVIOR_DEFAULT);
        if (covered) {
          getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
          c.show(WindowInsets.Type.statusBars());
          c.hide(WindowInsets.Type.navigationBars());
        } else {
          c.hide(WindowInsets.Type.systemBars());
        }
      }
    } else {
      getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
          | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
          | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }
  }

  // ---------- the keyboard covers the page; it never resizes it ----------
  private int imeHeight = 0;   // px the keyboard takes at the bottom of the screen; 0 while hidden
  private int lastShowing = -1;   // the bars the last inset change showed (for the trace)

  /**
   * The page is drawn edge to edge (hideBars), so the keyboard arrives at it as a window inset, and Chromium
   * reflows the page to the shorter space: innerHeight and visualViewport shrink, and fitStage (dom.ts) rescales
   * the whole 1024x600 stage. So the keyboard's inset is taken out here, before the page's views see it. The
   * window itself is adjustNothing (AndroidManifest), so nothing else resizes. A field that the keyboard would
   * cover is panned up instead (panPage).
   */
  private WindowInsets keepPageSizeFromKeyboard(View v, WindowInsets in) {
    int h = in.isVisible(WindowInsets.Type.ime()) ? in.getInsets(WindowInsets.Type.ime()).bottom : 0;
    if (h != imeHeight) {
      imeHeight = h;
      ui.post(this::panForKeyboard);
      scheduleRehide();   // the keyboard came or went: the bars may have moved, so check them again
    }
    measureTopBand(in);
    measureBottomBand(in);
    // this listener sees every inset change, so a bar that shows over Claude Home (swipe-reveal, focus) is caught here.
    // Each bar on its own: isVisible(status | nav) is true only while BOTH show, so once the nav bar was hidden
    // again a status bar still showing never re-triggered this (the status bar stuck after a top swipe).
    int showing = 0;
    if (in.isVisible(WindowInsets.Type.statusBars())) showing |= WindowInsets.Type.statusBars();
    if (in.isVisible(WindowInsets.Type.navigationBars())) showing |= WindowInsets.Type.navigationBars();
    if (showing != lastShowing) { trace("insets: showing " + barNames(showing) + (barsShouldBeHidden() ? "" : " (allowed)")); lastShowing = showing; }
    if (showing != 0 && barsShouldBeHidden()) scheduleRehide();
    return new WindowInsets.Builder(in).setInsets(WindowInsets.Type.ime(), Insets.NONE).build();
  }

  /** The focused field's bottom edge in CSS px, or null when no field has focus. */
  private static final String FOCUS_BOTTOM_JS =
      "(function(){var e=document.activeElement;if(!e||!(/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)||e.isContentEditable))return null;"
    + "return e.getBoundingClientRect().bottom;})()";

  /** A field took focus (Claude Keyboard started on it): the pages pan again for where it is now. */
  public static void refreshKeyboardPan() {
    MainActivity a = live;
    if (a != null) a.ui.post(a::panForKeyboard);
  }

  /** The keyboard came or went: the Hub page and the Browser's page pan so their focused field stays visible. */
  void panForKeyboard() {
    panPage(web);
    BrowserView b = BrowserView.get();
    if (b != null) b.keyboardPan();
  }

  /**
   * Moves a WebView up just enough to keep its focused field above the keyboard, and back down when there is
   * nothing to keep in view (or no keyboard). The view's size and the page's viewport are left alone.
   */
  void panPage(WebView v) {
    if (v == null) return;
    if (imeHeight <= 0 || v.getVisibility() != View.VISIBLE) { v.setTranslationY(0); return; }
    final int ime = imeHeight;
    v.evaluateJavascript(FOCUS_BOTTOM_JS, r -> {
      if (imeHeight != ime) return;   // the keyboard changed since; its own call pans again
      float css;
      try { css = Float.parseFloat(r); } catch (RuntimeException e) { css = -1; }   // "null": no field has focus
      DisplayMetrics dm = getResources().getDisplayMetrics();
      int[] at = new int[2];
      v.getLocationOnScreen(at);
      float top = at[1] - v.getTranslationY();   // where the view sits without the pan
      float keyboardTop = dm.heightPixels - ime - 8 * dm.density;
      float overlap = css < 0 ? 0 : top + css * v.getScale() - keyboardTop;
      v.setTranslationY(overlap > 0 ? -overlap : 0);
    });
  }

  // ---------- voice (VoiceService) ----------
  static volatile boolean resumed = false;

  /** Hand a voice event to the page, only while the page is the Claude Home server. */
  void voiceEvent(String json) {
    if (web == null || !bridge.isAllowed()) return;
    web.evaluateJavascript("window.hubVoice && window.hubVoice(" + json + ")", null);
  }

  /** The microphone grant, re-applied as device owner (lockdown() grants it too), with no Android dialog. True if the mic may be used now. */
  boolean grantMicSilently() {
    if (!isOwner()) return false;
    try { dpm().setPermissionGrantState(AdminReceiver.component(this), getPackageName(), "android.permission.RECORD_AUDIO", DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED); }
    catch (Exception e) { Log.w(TAG, "mic grant", e); }
    return VoiceService.micAllowed(this);
  }

  /** As device owner the grant is ours: re-apply it silently and never show Android's dialog. Otherwise Android asks (code 43). */
  void requestMicPermission() {
    if (isOwner()) {
      if (grantMicSilently() && VoiceService.wakeOn(this)) VoiceService.start(this, 0);
      return;
    }
    Kiosk.pause(5 * 60_000L);
    requestPermissions(new String[] { "android.permission.RECORD_AUDIO" }, 43);
  }

  /** The camera grant, re-applied as device owner (lockdown() grants it too), with no Android dialog. True if the camera may be used now. */
  boolean grantCameraSilently() {
    if (!isOwner()) return false;
    try { dpm().setPermissionGrantState(AdminReceiver.component(this), getPackageName(), "android.permission.CAMERA", DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED); }
    catch (Exception e) { Log.w(TAG, "camera grant", e); }
    return checkSelfPermission("android.permission.CAMERA") == android.content.pm.PackageManager.PERMISSION_GRANTED;
  }

  /** The Camera app's use: as device owner the grant is ours, so it is re-applied silently and Android never asks.
   *  Otherwise Android asks once (CameraView, request code 44). */
  void requestCameraPermission() {
    if (isOwner()) { CameraView.onPermission(grantCameraSilently()); return; }
    Kiosk.pause(5 * 60_000L);
    requestPermissions(new String[] { "android.permission.CAMERA" }, CameraView.PERMISSION_REQUEST);
  }

  @Override public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
    super.onRequestPermissionsResult(code, perms, results);
    if (BrowserView.get() != null) BrowserView.get().permissionResult(code);   // a site's camera or mic (BrowserView)
    if (code == 43 && VoiceService.micAllowed(this) && VoiceService.wakeOn(this)) VoiceService.start(this, 0);
    if (code == CameraView.PERMISSION_REQUEST) CameraView.onPermission(results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED);
  }

  /** The pickers of the Browser (files, camera) report here. */
  @Override protected void onActivityResult(int req, int res, Intent data) {
    super.onActivityResult(req, res, data);
    if (BrowserView.get() != null) BrowserView.get().onResult(req, res, data);
  }

  @Override protected void onResume() {
    super.onResume();
    resumed = true;
    // the wake word listens from here on (a microphone service may only start while the app is in front)
    if (VoiceService.wakeOn(this) && VoiceService.micAllowed(this) && VoiceService.mode() == VoiceService.Mode.OFF) VoiceService.start(this, 0);
    Kiosk.resume();   // back on the Hub: the guard is on duty again
    live = this;
    inFront = true;
    allowedAppFront = false;   // Claude Home is in front: lock task features go back to NONE (in lockdown below)
    BackButton.hide();         // the floating way back is only for an allowed app in front (BackButton)
    Guard.refreshStrip();
    ui.postDelayed(() -> Kiosk.ensureGuard(this), 1500);   // re-bind the helper if an update dropped it
    lockdown();
    AdbWifi.reapply(this);
    pin();     // enter lock task first (first start after a reboot too), then hide the bars for good
    hideBars();
    sideBackGestureOff(true);   // no Android back arrow over ClaudeOS (sideBackGestureOff)
    web.onResume();
    web.evaluateJavascript("window.hubResume && window.hubResume()", null);   // e.g. a setup step just finished
  }

  @Override protected void onPause() {
    super.onPause();
    inFront = false;
    Guard.refreshStrip();
    resumed = false;
    sideBackGestureOff(false);  // another app or Android's Settings in front: Android's back gesture is back there
    web.onPause();
    CameraView.stopForPause();   // the camera is released while Claude Home isn't in front
  }

  @Override protected void onStop() {
    super.onStop();
    CameraView.stopForPause();
  }

  @Override public void onWindowFocusChanged(boolean focus) {
    super.onWindowFocusChanged(focus);
    if (focus) hideBars();
  }

  @Override protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    if (BrowserView.fromIntent(i) && web != null) web.evaluateJavascript("window.hubBrowserIncoming && window.hubBrowserIncoming()", null);
    String u = i.getStringExtra("url");
    if (u != null && u.startsWith("http")) {
      url = u;
      getSharedPreferences("hub", MODE_PRIVATE).edit().putString("url", u).apply();
      loadHub();
    }
  }

  /** Back does nothing to Android; the page can listen for it (window.hubBack). */
  @SuppressWarnings("deprecation")
  @Override public void onBackPressed() {
    goBack();
  }

  /** Back, from Android's back event or ClaudeOS's own side swipe (sideSwipe). */
  private void goBack() {
    if (BrowserView.get() != null && BrowserView.get().goBack()) return;   // a browser page on screen goes back first
    web.evaluateJavascript("window.hubBack && window.hubBack()", null);
  }

  // ---------- volume keys: adjusted here with no system panel; the page draws its own HUD ----------
  @Override public boolean dispatchKeyEvent(KeyEvent e) {
    int code = e.getKeyCode();
    if (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN) {
      if (e.getAction() == KeyEvent.ACTION_DOWN) {
        volumeStep(code == KeyEvent.KEYCODE_VOLUME_UP ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER);
      }
      return true;   // key-up is consumed too, so Android's own volume panel never shows
    }
    return super.dispatchKeyEvent(e);
  }

  /** One step of the media volume (flags 0: no system UI), then the page gets the new level, 0..1 (window.onHubVolume). */
  private void volumeStep(int direction) {
    AudioManager a = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    a.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, 0);
    int max = a.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
    double level = max > 0 ? a.getStreamVolume(AudioManager.STREAM_MUSIC) / (double) max : 0;
    if (web != null && bridge.isAllowed()) {
      web.evaluateJavascript(String.format(Locale.US, "window.onHubVolume && window.onHubVolume(%.3f)", level), null);
    }
  }

  @Override protected void onDestroy() {
    if (VoiceService.sink != null) VoiceService.sink = null;
    web.destroy();
    super.onDestroy();
  }
}
