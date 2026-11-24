package hub.kiosk;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import java.io.BufferedReader;
import java.io.InputStreamReader;

/**
 * Android's wireless debugging (ADB over Wi-Fi), switched from ClaudeOS so the user never opens developer options.
 *
 * The switch is Settings.Global "adb_wifi_enabled" (1/0). Writing it needs WRITE_SECURE_SETTINGS, which is granted
 * once from the PC (adb shell pm grant hub.kiosk android.permission.WRITE_SECURE_SETTINGS). Without it the state is
 * "needsGrant" and the Settings page says so. Android turns wireless debugging off when Wi-Fi changes networks, so
 * with "Keep on after restart" (a pref, on by default once enabled) it is switched back on at start-up and whenever
 * a network comes back.
 */
@SuppressWarnings("deprecation")   // WifiInfo.getIpAddress: deprecated, still the simple way on Android 14
final class AdbWifi {
  private AdbWifi() { }

  private static final String KEY = "adb_wifi_enabled";   // @hide in the SDK, so by name
  private static final String PREF_KEEP = "adbWifiKeep";
  private static final String PERM = "android.permission.WRITE_SECURE_SETTINGS";
  private static boolean watching = false;

  static boolean canControl(Context c) {
    return c.checkSelfPermission(PERM) == PackageManager.PERMISSION_GRANTED;
  }

  static boolean isOn(Context c) {
    try { return Settings.Global.getInt(c.getContentResolver(), KEY, 0) == 1; }
    catch (RuntimeException e) { return false; }
  }

  private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("hub", Context.MODE_PRIVATE); }

  static boolean keep(Context c) { return prefs(c).getBoolean(PREF_KEEP, false); }
  static void setKeep(Context c, boolean on) { prefs(c).edit().putBoolean(PREF_KEEP, on).apply(); }

  /** Writes the switch. Null on success, "needsGrant" without WRITE_SECURE_SETTINGS, else a reason. */
  static String set(Context c, boolean on) {
    if (!canControl(c)) return "needsGrant";
    ContentResolver r = c.getContentResolver();
    try {
      if (on) {
        // the developer switches wireless debugging depends on: best effort, the wireless switch is what matters
        try { Settings.Global.putInt(r, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 1); } catch (SecurityException ignored) { }
        try { Settings.Global.putInt(r, Settings.Global.ADB_ENABLED, 1); } catch (SecurityException ignored) { }
        if (!prefs(c).contains(PREF_KEEP)) setKeep(c, true);   // on by default once it has been enabled
      }
      if (!Settings.Global.putInt(r, KEY, on ? 1 : 0)) return "couldn't change wireless debugging";
      return null;
    } catch (SecurityException e) {
      return "needsGrant";
    } catch (RuntimeException e) {
      return "couldn't change wireless debugging";
    }
  }

  /** The user's own switch: turning it off also stops it coming back after a restart. */
  static String setUser(Context c, boolean on) {
    String err = set(c, on);
    if (err == null && !on) setKeep(c, false);
    return err;
  }

  /** At start-up, on resume and when a network returns: switch it back on if the user wants it kept on. */
  static void reapply(Context c) {
    if (!keep(c) || isOn(c) || !canControl(c)) return;
    set(c, true);
  }

  /** Start-up retry delays after the app starts (ms). Android can switch it off after the first attempt, so try again. */
  static final long[] RETRY_MS = { 10_000, 30_000, 90_000 };

  /** Calls reapply again at each RETRY_MS delay when the user keeps it on. Bounded: nothing repeats after the last delay. */
  static void retryAtStart(Context c) {
    if (!keep(c)) return;
    final Context app = c.getApplicationContext();
    Handler ui = new Handler(Looper.getMainLooper());
    for (long ms : RETRY_MS) ui.postDelayed(() -> reapply(app), ms);
  }

  /** Re-applies after Wi-Fi changes networks (Android switches wireless debugging off then). Registered once. */
  static synchronized void watch(Context c) {
    if (watching) return;
    final Context app = c.getApplicationContext();
    try {
      ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
      final Handler ui = new Handler(Looper.getMainLooper());
      cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) {
          ui.postDelayed(() -> reapply(app), 3000);   // give Wi-Fi a moment to settle
        }
      });
      watching = true;
    } catch (RuntimeException ignored) { }
  }

  /** This tablet's Wi-Fi IPv4 address, "" when not on Wi-Fi. */
  static String ip(Context c) {
    try {
      WifiManager w = (WifiManager) c.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
      WifiInfo i = w.getConnectionInfo();
      int ip = i == null ? 0 : i.getIpAddress();
      if (ip == 0) return "";
      return (ip & 255) + "." + (ip >> 8 & 255) + "." + (ip >> 16 & 255) + "." + (ip >> 24 & 255);
    } catch (RuntimeException e) {
      return "";
    }
  }

  // The port comes from the wireless debugging service's own announcement on the network ("_adb-tls-connect._tcp",
  // the same one adb finds it by). The system property below is empty on some builds, so this is the main source.
  // It changes each time wireless debugging is switched on; discovery runs while it is on and keeps the port current.
  private static volatile String foundPort = "";
  private static NsdManager.DiscoveryListener discovering;

  /** Starts listening for the announcement, once. The port shows up a moment later (port()). */
  static synchronized void findPort(Context c) {
    if (discovering != null) return;
    try {
      final NsdManager nsd = c.getApplicationContext().getSystemService(NsdManager.class);
      discovering = new NsdManager.DiscoveryListener() {
        @Override public void onDiscoveryStarted(String serviceType) { }
        @Override public void onServiceFound(NsdServiceInfo info) {
          if (info.getServiceType() == null || !info.getServiceType().contains("_adb-tls-connect")) return;
          nsd.resolveService(info, new NsdManager.ResolveListener() {
            @Override public void onResolveFailed(NsdServiceInfo i, int errorCode) { }
            @Override public void onServiceResolved(NsdServiceInfo i) { foundPort = String.valueOf(i.getPort()); }
          });
        }
        @Override public void onServiceLost(NsdServiceInfo info) { foundPort = ""; }
        @Override public void onDiscoveryStopped(String serviceType) { discovering = null; }
        @Override public void onStartDiscoveryFailed(String serviceType, int errorCode) { discovering = null; }
        @Override public void onStopDiscoveryFailed(String serviceType, int errorCode) { }
      };
      nsd.discoverServices("_adb-tls-connect._tcp", NsdManager.PROTOCOL_DNS_SD, discovering);
    } catch (RuntimeException e) {
      discovering = null;
    }
  }

  /** The port wireless debugging listens on (it changes each time it is switched on), "" when not known. */
  static String port() {
    String seen = foundPort;
    if (!seen.isEmpty()) return seen;
    try {
      Process p = new ProcessBuilder("getprop", "service.adb.tls.port").redirectErrorStream(true).start();
      String line;
      try (BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
        line = br.readLine();
      }
      p.waitFor();
      String v = line == null ? "" : line.trim();
      return v.matches("\\d{2,5}") && !v.equals("0") ? v : "";
    } catch (Exception e) {
      return "";
    }
  }
}
