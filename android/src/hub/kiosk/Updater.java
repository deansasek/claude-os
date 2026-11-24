package hub.kiosk;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Silent self-update, device owner only. The Hub server offers the newest build:
 *   GET {server}/apk/version          -> {"versionCode": N}
 *   GET {server}/apk/claude-hub.apk   -> the signed APK
 * If N is newer than the installed build, the APK is streamed into a PackageInstaller session. As device
 * owner no prompt appears (USER_ACTION_NOT_REQUIRED); Android replaces the app and BootReceiver starts it again.
 */
final class Updater {
  private Updater() { }
  private static final AtomicBoolean busy = new AtomicBoolean(false);

  /** Called by UpdateReceiver with the installer's answer: a failed install may be tried again later. */
  static void finished(boolean ok) { if (!ok) busy.set(false); }

  /** {"status": "not owner" | "up to date" | "updating" | "busy" | "error", ...}. Blocks only for the version check. */
  static String check(MainActivity act, String server) {
    if (!act.isOwner()) return "{\"status\":\"not owner\"}";
    try {
      int installed = (int) installedVersion(act);
      HttpURLConnection c = open(server + "/apk/version", 5000);
      int latest = new JSONObject(read(c, 1024)).getInt("versionCode");
      c.disconnect();
      if (latest <= installed) return "{\"status\":\"up to date\",\"versionCode\":" + installed + "}";
      if (!busy.compareAndSet(false, true)) return "{\"status\":\"busy\"}";
      final int target = latest;
      new Thread(() -> install(act, server, target, installed)).start();
      return "{\"status\":\"updating\",\"from\":" + installed + ",\"to\":" + latest + "}";
    } catch (Exception e) {
      Log.w(MainActivity.TAG, "update check", e);
      return "{\"status\":\"error\",\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
    }
  }

  /**
   * Check only: the installed build and the newest one the Hub offers. Installs nothing, so Settings can show
   * the state before the person confirms an update. {"status": "ok", "installed": N, "latest": M} or an error.
   */
  static String available(MainActivity act, String server) {
    if (!act.isOwner()) return "{\"status\":\"not owner\"}";
    try {
      int installed = (int) installedVersion(act);
      HttpURLConnection c = open(server + "/apk/version", 5000);
      int latest = new JSONObject(read(c, 1024)).getInt("versionCode");
      c.disconnect();
      return "{\"status\":\"ok\",\"installed\":" + installed + ",\"latest\":" + latest + "}";
    } catch (Exception e) {
      Log.w(MainActivity.TAG, "update available", e);
      return "{\"status\":\"error\",\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
    }
  }

  private static long installedVersion(Context c) throws Exception {
    PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
    return pi.getLongVersionCode();
  }

  private static void install(Context c, String server, int target, int installed) {
    PackageInstaller pi = c.getPackageManager().getPackageInstaller();
    int id = -1;
    PackageInstaller.Session s = null;
    try {
      PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
      p.setAppPackageName(c.getPackageName());
      if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
      id = pi.createSession(p);
      s = pi.openSession(id);
      HttpURLConnection h = open(server + "/apk/claude-hub.apk", 60000);
      if (h.getResponseCode() != 200) throw new IllegalStateException("apk http " + h.getResponseCode());
      long len = h.getContentLengthLong();
      try (InputStream in = h.getInputStream(); OutputStream out = s.openWrite("claude-hub.apk", 0, len)) {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        s.fsync(out);
      }
      Intent result = new Intent(c, UpdateReceiver.class);
      int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
      s.commit(PendingIntent.getBroadcast(c, id, result, flags).getIntentSender());
      Log.i(MainActivity.TAG, "update " + installed + " -> " + target + " committed");
    } catch (Exception e) {
      Log.w(MainActivity.TAG, "update failed", e);
      try {
        if (s != null) s.abandon(); else if (id != -1) pi.abandonSession(id);
      } catch (Exception ignored) { }
      busy.set(false);
    } finally {
      if (s != null) s.close();
    }
  }

  private static HttpURLConnection open(String u, int timeoutMs) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
    c.setConnectTimeout(5000);
    c.setReadTimeout(timeoutMs);
    return c;
  }

  private static String read(HttpURLConnection c, int max) throws Exception {
    if (c.getResponseCode() != 200) throw new IllegalStateException("http " + c.getResponseCode());
    try (InputStream in = c.getInputStream()) {
      ByteArrayOutputStream b = new ByteArrayOutputStream();
      byte[] buf = new byte[512];
      int n, total = 0;
      while ((n = in.read(buf)) > 0) { total += n; if (total > max) throw new IllegalStateException("too big"); b.write(buf, 0, n); }
      return b.toString("UTF-8");
    }
  }
}
