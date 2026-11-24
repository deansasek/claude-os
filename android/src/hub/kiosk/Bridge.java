package hub.kiosk;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import hub.kiosk.ime.ImeSettings;

/**
 * window.HubDevice: what the Hub page may ask of the tablet. Every method returns a JSON string.
 * The list is fixed and short on purpose; nothing here runs arbitrary commands.
 * Calls are refused unless the page loaded is the Hub server (MainActivity sets that).
 */
@SuppressWarnings("deprecation")   // WifiConfiguration etc.: deprecated, but still the device-owner way on Android 14
public class Bridge {
  private final MainActivity act;
  private final WebView web;
  private volatile boolean allowed = false;

  /** Never hide these: the tablet stops working, or the Hub can't draw. */
  private static final Set<String> PROTECTED = new HashSet<>(Arrays.asList(
      "android", "hub.kiosk", "com.android.systemui", "com.android.settings", "com.android.shell",
      "com.google.android.webview", "com.android.webview", "com.google.android.gms", "com.android.vending",
      "com.android.phone", "com.android.bluetooth", "com.android.networkstack", "com.android.wifi.resources",
      "com.google.android.networkstack", "com.android.permissioncontroller", "com.google.android.permissioncontroller",
      "com.android.packageinstaller", "com.google.android.packageinstaller", "com.android.providers.settings",
      "com.android.providers.media", "com.android.providers.downloads", "com.android.externalstorage",
      "com.android.location.fused", "com.android.server.telecom", "com.android.se", "com.android.nfc"));

  Bridge(MainActivity act, WebView web) { this.act = act; this.web = web; }
  void setAllowed(boolean on) { allowed = on; }

  private static String err(String msg) { return "{\"error\":" + JSONObject.quote(msg) + "}"; }
  private static final String DENIED = err("not allowed");
  private static final String OK = "{\"ok\":true}";

  private DevicePolicyManager dpm() { return act.dpm(); }
  private ComponentName admin() { return AdminReceiver.component(act); }
  private WifiManager wm() { return (WifiManager) act.getApplicationContext().getSystemService(Context.WIFI_SERVICE); }
  private AudioManager audio() { return (AudioManager) act.getSystemService(Context.AUDIO_SERVICE); }

  // ---------- about ----------
  @JavascriptInterface public String info() {
    if (!allowed) return DENIED;
    try {
      JSONObject o = new JSONObject();
      PackageInfo pi = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
      o.put("app", pi.versionName);
      o.put("model", Build.MODEL);
      o.put("maker", Build.MANUFACTURER);
      o.put("android", Build.VERSION.RELEASE);
      o.put("sdk", Build.VERSION.SDK_INT);
      o.put("owner", act.isOwner());
      o.put("pinned", act.isPinned());
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  // ---------- battery ----------
  @JavascriptInterface public String battery() {
    if (!allowed) return DENIED;
    try {
      Intent b = act.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
      if (b == null) return err("no battery info");
      int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
      int status = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1), plugged = b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
      int health = b.getIntExtra(BatteryManager.EXTRA_HEALTH, 0);
      JSONObject o = new JSONObject();
      o.put("percent", level >= 0 ? Math.round(level * 100f / scale) : -1);
      o.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
      o.put("full", status == BatteryManager.BATTERY_STATUS_FULL);
      o.put("plugged", plugged == BatteryManager.BATTERY_PLUGGED_AC ? "ac" : plugged == BatteryManager.BATTERY_PLUGGED_USB ? "usb"
          : plugged == BatteryManager.BATTERY_PLUGGED_WIRELESS ? "wireless" : plugged != 0 ? "dock" : "");
      o.put("tempC", b.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0);
      o.put("voltage", b.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0) / 1000.0);
      o.put("health", health == BatteryManager.BATTERY_HEALTH_GOOD ? "good" : health == BatteryManager.BATTERY_HEALTH_OVERHEAT ? "overheat"
          : health == BatteryManager.BATTERY_HEALTH_DEAD ? "dead" : health == BatteryManager.BATTERY_HEALTH_COLD ? "cold" : "unknown");
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  // ---------- wi-fi ----------
  private static String unquote(String s) { return s != null && s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"") ? s.substring(1, s.length() - 1) : s; }
  private static int bars(int rssi) { return WifiManager.calculateSignalLevel(rssi, 5); }

  @JavascriptInterface public String wifi() {
    if (!allowed) return DENIED;
    try {
      WifiManager w = wm();
      JSONObject o = new JSONObject();
      o.put("enabled", w.isWifiEnabled());
      WifiInfo i = w.getConnectionInfo();
      if (i != null && i.getNetworkId() != -1) {
        o.put("ssid", unquote(i.getSSID()));
        o.put("bars", bars(i.getRssi()));
        int ip = i.getIpAddress();
        o.put("ip", (ip & 255) + "." + (ip >> 8 & 255) + "." + (ip >> 16 & 255) + "." + (ip >> 24 & 255));
        o.put("mbps", i.getLinkSpeed());
      }
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  @JavascriptInterface public String wifiScan() {
    if (!allowed) return DENIED;
    try { return "{\"ok\":" + wm().startScan() + "}"; } catch (Exception e) { return err(e.toString()); }
  }

  /** Networks in range, strongest per name, with whether each is saved or the current one. */
  @JavascriptInterface public String wifiNetworks() {
    if (!allowed) return DENIED;
    try {
      WifiManager w = wm();
      Set<String> saved = new HashSet<>();
      List<WifiConfiguration> configs = w.getConfiguredNetworks();
      if (configs != null) for (WifiConfiguration c : configs) saved.add(unquote(c.SSID));
      WifiInfo cur = w.getConnectionInfo();
      String current = cur != null && cur.getNetworkId() != -1 ? unquote(cur.getSSID()) : null;
      Map<String, ScanResult> best = new HashMap<>();
      for (ScanResult r : w.getScanResults()) {
        if (r.SSID == null || r.SSID.isEmpty()) continue;
        ScanResult prev = best.get(r.SSID);
        if (prev == null || r.level > prev.level) best.put(r.SSID, r);
      }
      JSONArray a = new JSONArray();
      for (ScanResult r : best.values()) {
        String caps = r.capabilities == null ? "" : r.capabilities;
        JSONObject o = new JSONObject();
        o.put("ssid", r.SSID);
        o.put("bars", bars(r.level));
        o.put("secure", caps.contains("WPA") || caps.contains("WEP") || caps.contains("SAE") || caps.contains("EAP"));
        o.put("enterprise", caps.contains("EAP"));
        o.put("wpa3", caps.contains("SAE") && !caps.contains("PSK"));
        o.put("saved", saved.contains(r.SSID));
        o.put("current", r.SSID.equals(current));
        a.put(o);
      }
      return a.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  /** Join a network (device owners may still add networks on Android 10+). Empty password = open network. */
  @JavascriptInterface public String wifiConnect(String ssid, String password) {
    if (!allowed) return DENIED;
    if (!act.isOwner()) {   // ordinary apps can't join networks on Android 10+: show Android's own Wi-Fi panel over the Hub
      act.runOnUiThread(() -> act.openAndroid(new Intent(Settings.Panel.ACTION_WIFI)));
      return "{\"ok\":true,\"panel\":true}";
    }
    try {
      WifiManager w = wm();
      if (!w.isWifiEnabled()) w.setWifiEnabled(true);
      int id = -1;
      List<WifiConfiguration> configs = w.getConfiguredNetworks();
      if (configs != null) for (WifiConfiguration c : configs) if (ssid.equals(unquote(c.SSID))) id = c.networkId;
      if (password != null && !password.isEmpty() || id == -1) {
        WifiConfiguration c = new WifiConfiguration();
        c.SSID = "\"" + ssid + "\"";
        boolean wpa3 = false;
        for (ScanResult r : w.getScanResults()) if (ssid.equals(r.SSID) && r.capabilities != null && r.capabilities.contains("SAE") && !r.capabilities.contains("PSK")) wpa3 = true;
        if (password == null || password.isEmpty()) {
          if (Build.VERSION.SDK_INT >= 30) c.setSecurityParams(WifiConfiguration.SECURITY_TYPE_OPEN);
          else c.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE);
        } else {
          if (Build.VERSION.SDK_INT >= 30) c.setSecurityParams(wpa3 ? WifiConfiguration.SECURITY_TYPE_SAE : WifiConfiguration.SECURITY_TYPE_PSK);
          c.preSharedKey = "\"" + password + "\"";
        }
        if (id != -1) { c.networkId = id; id = w.updateNetwork(c); }
        else id = w.addNetwork(c);
      }
      if (id == -1) return err("The tablet wouldn't save that network");
      w.disconnect();
      boolean ok = w.enableNetwork(id, true);
      w.reconnect();
      return "{\"ok\":" + ok + "}";
    } catch (Exception e) { return err(e.toString()); }
  }

  @JavascriptInterface public String wifiForget(String ssid) {
    if (!allowed) return DENIED;
    try {
      WifiManager w = wm();
      boolean any = false;
      List<WifiConfiguration> configs = w.getConfiguredNetworks();
      if (configs != null) for (WifiConfiguration c : configs) if (ssid.equals(unquote(c.SSID))) any |= w.removeNetwork(c.networkId);
      return "{\"ok\":" + any + "}";
    } catch (Exception e) { return err(e.toString()); }
  }

  @JavascriptInterface public String wifiEnable(boolean on) {
    if (!allowed) return DENIED;
    try { return "{\"ok\":" + wm().setWifiEnabled(on) + "}"; } catch (Exception e) { return err(e.toString()); }
  }

  // ---------- screen ----------
  /** Brightness 0..1. As device owner it sets the real system brightness; otherwise just this window. */
  @JavascriptInterface public String brightness() {
    if (!allowed) return DENIED;
    try {
      int v = Settings.System.getInt(act.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, 128);
      return "{\"value\":" + (v / 255.0) + "}";
    } catch (Exception e) { return err(e.toString()); }
  }

  @JavascriptInterface public String setBrightness(double v) {
    if (!allowed) return DENIED;
    final float f = (float) Math.max(0.01, Math.min(1, v));
    try {
      if (act.isOwner()) {
        dpm().setSystemSetting(admin(), Settings.System.SCREEN_BRIGHTNESS_MODE, String.valueOf(Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL));
        dpm().setSystemSetting(admin(), Settings.System.SCREEN_BRIGHTNESS, String.valueOf(Math.round(f * 255)));
        act.runOnUiThread(() -> { WindowManager.LayoutParams p = act.getWindow().getAttributes(); p.screenBrightness = -1f; act.getWindow().setAttributes(p); });
      } else if (Settings.System.canWrite(act)) {
        Settings.System.putInt(act.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
        Settings.System.putInt(act.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, Math.round(f * 255));
        act.runOnUiThread(() -> { WindowManager.LayoutParams p = act.getWindow().getAttributes(); p.screenBrightness = -1f; act.getWindow().setAttributes(p); });
      } else {
        act.runOnUiThread(() -> { WindowManager.LayoutParams p = act.getWindow().getAttributes(); p.screenBrightness = f; act.getWindow().setAttributes(p); });
      }
      return OK;
    } catch (Exception e) { return err(e.toString()); }
  }

  // ---------- Google account on the tablet: the names only (never a token); sign-in opens Google's own screen ----------
  /** The Google accounts added to this tablet, by name. */
  @JavascriptInterface public String googleAccounts() {
    if (!allowed) return DENIED;
    try {
      android.accounts.Account[] list = android.accounts.AccountManager.get(act).getAccountsByType("com.google");
      JSONArray arr = new JSONArray();
      for (android.accounts.Account a : list) {
        JSONObject o = new JSONObject();
        o.put("name", a.name);
        arr.put(o);
      }
      JSONObject out = new JSONObject();
      out.put("accounts", arr);
      return out.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  /** Starts Google's sign-in for a new account. The page explains it first (Settings → Google account). */
  @JavascriptInterface public String addGoogleAccount() {
    if (!allowed) return DENIED;
    try {
      android.accounts.AccountManager.get(act).addAccount("com.google", null, null, null, act, null, null);
      return OK;
    } catch (Exception e) { return err(e.toString()); }
  }

  /** Checks that the tablet can get a read-only Google token for "calendar" or "gmail". The token itself never
   *  leaves the tablet: the answer is ok, consent (Google must be approved once), or an error. */
  @JavascriptInterface public String googleCheck(String which) {
    if (!allowed) return DENIED;
    String scope;
    if ("calendar".equals(which)) scope = "https://www.googleapis.com/auth/calendar.readonly";
    else if ("gmail".equals(which)) scope = "https://www.googleapis.com/auth/gmail.readonly";
    else return err("unknown scope");
    try {
      android.accounts.AccountManager am = android.accounts.AccountManager.get(act);
      android.accounts.Account[] list = am.getAccountsByType("com.google");
      if (list.length == 0) return err("no Google account on this tablet");
      android.os.Bundle b = am.getAuthToken(list[0], "oauth2:" + scope, null, false, null, null)
          .getResult(20, java.util.concurrent.TimeUnit.SECONDS);
      if (b == null) return err("no answer from Google");
      if (b.getString(android.accounts.AccountManager.KEY_AUTHTOKEN) != null) return OK;
      if (b.get(android.accounts.AccountManager.KEY_INTENT) != null) return "{\"consent\":true}";
      return err(b.getString(android.accounts.AccountManager.KEY_ERROR_MESSAGE, "no token"));
    } catch (Exception e) { return err(e.toString()); }
  }

  @JavascriptInterface public String keepAwake(boolean on) {
    if (!allowed) return DENIED;
    act.runOnUiThread(() -> {
      if (on) act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      else act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    });
    return OK;
  }

  /** A system setting: as device owner through the policy (it sticks), else through WRITE_SETTINGS. Returns an error text, or null. */
  private String putSystem(String key, String value) {
    try {
      if (act.isOwner()) { dpm().setSystemSetting(admin(), key, value); return null; }
      if (!Settings.System.canWrite(act)) return "Finish Desk mode setup first.";
      return Settings.System.putString(act.getContentResolver(), key, value) ? null : "The tablet wouldn't change that";
    } catch (Exception e) { return e.toString(); }
  }

  /** {auto, offSec}: is Android's auto-brightness on, and the screen-off time in seconds (0 = never). */
  @JavascriptInterface public String screen() {
    if (!allowed) return DENIED;
    try {
      boolean auto = Settings.System.getInt(act.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, 0)
          == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC;
      long ms = Settings.System.getLong(act.getContentResolver(), Settings.System.SCREEN_OFF_TIMEOUT, 60000L);
      JSONObject o = new JSONObject();
      o.put("auto", auto);
      o.put("offSec", ms >= Integer.MAX_VALUE ? 0 : ms / 1000);
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  @JavascriptInterface public String setAutoBrightness(boolean on) {
    if (!allowed) return DENIED;
    String e = putSystem(Settings.System.SCREEN_BRIGHTNESS_MODE,
        String.valueOf(on ? Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC : Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL));
    return e == null ? OK : err(e);
  }

  /** Seconds until the screen turns off by itself; 0 means never. */
  @JavascriptInterface public String setScreenOff(int sec) {
    if (!allowed) return DENIED;
    long ms = sec <= 0 ? Integer.MAX_VALUE : Math.min(sec, 3600) * 1000L;
    String e = putSystem(Settings.System.SCREEN_OFF_TIMEOUT, String.valueOf(ms));
    return e == null ? OK : err(e);
  }

  // ---------- sound ----------
  private int stream(String name) {
    return "alarm".equals(name) ? AudioManager.STREAM_ALARM : "notification".equals(name) ? AudioManager.STREAM_NOTIFICATION : AudioManager.STREAM_MUSIC;
  }

  /** {media, alarm, notification}, each 0..1. Changes are made with no stock volume panel (flags 0). */
  @JavascriptInterface public String volume() {
    if (!allowed) return DENIED;
    try {
      AudioManager a = audio();
      JSONObject o = new JSONObject();
      o.put("media", a.getStreamVolume(AudioManager.STREAM_MUSIC) / (double) a.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
      o.put("alarm", a.getStreamVolume(AudioManager.STREAM_ALARM) / (double) a.getStreamMaxVolume(AudioManager.STREAM_ALARM));
      o.put("notification", a.getStreamVolume(AudioManager.STREAM_NOTIFICATION) / (double) a.getStreamMaxVolume(AudioManager.STREAM_NOTIFICATION));
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  @JavascriptInterface public String setVolume(String which, double v) {
    if (!allowed) return DENIED;
    try {
      AudioManager a = audio();
      int s = stream(which), max = a.getStreamMaxVolume(s);
      a.setStreamVolume(s, (int) Math.round(Math.max(0, Math.min(1, v)) * max), 0);
      return OK;
    } catch (Exception e) { return err(e.toString()); }
  }

  // ---------- storage, time zone, Bluetooth (read only: switching Bluetooth on or pairing needs Android's own screens) ----------
  /** {total, free} in bytes, for the data partition (where apps keep their files). */
  @JavascriptInterface public String storage() {
    if (!allowed) return DENIED;
    try {
      android.os.StatFs s = new android.os.StatFs(android.os.Environment.getDataDirectory().getPath());
      JSONObject o = new JSONObject();
      o.put("total", s.getTotalBytes());
      o.put("free", s.getAvailableBytes());
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  /** {id, auto}: the time zone in use, and whether Android sets it itself from the network. */
  @JavascriptInterface public String timeZone() {
    if (!allowed) return DENIED;
    try {
      JSONObject o = new JSONObject();
      o.put("id", java.util.TimeZone.getDefault().getID());
      o.put("auto", Settings.Global.getInt(act.getContentResolver(), Settings.Global.AUTO_TIME_ZONE, 0) != 0);
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  /** Sets the time zone (device owner). The automatic zone is switched off first, so Android keeps this one. */
  @JavascriptInterface public String setTimeZone(String id) {
    if (!allowed) return DENIED;
    if (!act.isOwner()) return err("Finish Desk mode setup first.");
    if (id == null || !Arrays.asList(java.util.TimeZone.getAvailableIDs()).contains(id)) return err("unknown time zone");
    try {
      try { dpm().setGlobalSetting(admin(), Settings.Global.AUTO_TIME_ZONE, "0"); } catch (Exception e) { /* older Android: the zone is set anyway */ }
      return dpm().setTimeZone(admin(), id) ? OK : err("The tablet wouldn't change the time zone");
    } catch (Exception e) { return err(e.toString()); }
  }

  /** {supported, on, devices: [{name, mac}]}: Bluetooth's state, and the devices already paired with the tablet. */
  @JavascriptInterface public String bluetooth() {
    if (!allowed) return DENIED;
    try {
      android.bluetooth.BluetoothAdapter bt = android.bluetooth.BluetoothAdapter.getDefaultAdapter();
      JSONObject o = new JSONObject();
      JSONArray list = new JSONArray();
      o.put("supported", bt != null);
      if (bt != null) {
        o.put("on", bt.isEnabled());
        // the names need BLUETOOTH_CONNECT, which lockdown() grants to this app as device owner
        if (bt.isEnabled() && (Build.VERSION.SDK_INT < 31 || granted("android.permission.BLUETOOTH_CONNECT"))) {
          for (android.bluetooth.BluetoothDevice d : bt.getBondedDevices()) {
            JSONObject x = new JSONObject();
            x.put("name", d.getName() == null ? d.getAddress() : d.getName());
            x.put("mac", d.getAddress());
            list.put(x);
          }
        }
      }
      o.put("devices", list);
      return o.toString();
    } catch (SecurityException e) { return err("Bluetooth permission isn't granted yet"); }
    catch (Exception e) { return err(e.toString()); }
  }

  // ---------- apps (for hiding the stock keyboard and preinstalled extras) ----------
  @JavascriptInterface public String apps() {
    if (!allowed) return DENIED;
    try {
      PackageManager pm = act.getPackageManager();
      boolean owner = act.isOwner();
      JSONArray a = new JSONArray();
      for (ApplicationInfo ai : pm.getInstalledApplications(PackageManager.MATCH_UNINSTALLED_PACKAGES)) {
        JSONObject o = new JSONObject();
        o.put("id", ai.packageName);
        o.put("name", String.valueOf(pm.getApplicationLabel(ai)));
        o.put("system", (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
        o.put("hidden", owner && dpm().isApplicationHidden(admin(), ai.packageName));
        o.put("protected", PROTECTED.contains(ai.packageName));
        a.put(o);
      }
      return a.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  @JavascriptInterface public String setAppHidden(String pkg, boolean hidden) {
    if (!allowed) return DENIED;
    if (!act.isOwner()) return err("Finish Desk mode setup first.");
    if (PROTECTED.contains(pkg) || pkg.startsWith("com.android.providers.")) return err("that one is needed by the tablet");
    try { return "{\"ok\":" + dpm().setApplicationHidden(admin(), pkg, hidden) + "}"; } catch (Exception e) { return err(e.toString()); }
  }

  // ---------- kiosk setup without device owner: a checklist of one-time Android settings ----------
  private boolean granted(String p) { return act.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }
  private boolean guardOn() {
    String s = Settings.Secure.getString(act.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
    return s != null && s.contains(act.getPackageName() + "/");
  }
  private boolean isHome() {
    android.app.role.RoleManager rm = act.getSystemService(android.app.role.RoleManager.class);
    return rm != null && rm.isRoleHeld(android.app.role.RoleManager.ROLE_HOME);
  }
  private static JSONObject item(String id, String title, String detail, boolean done, boolean optional) throws Exception {
    JSONObject o = new JSONObject();
    o.put("id", id); o.put("title", title); o.put("detail", detail); o.put("done", done); o.put("optional", optional);
    return o;
  }

  @JavascriptInterface public String setup() {
    if (!allowed) return DENIED;
    try {
      boolean wifiPerm = granted("android.permission.ACCESS_FINE_LOCATION") && (Build.VERSION.SDK_INT < 33 || granted("android.permission.NEARBY_WIFI_DEVICES"));
      android.location.LocationManager lm = (android.location.LocationManager) act.getSystemService(Context.LOCATION_SERVICE);
      android.os.PowerManager pm = (android.os.PowerManager) act.getSystemService(Context.POWER_SERVICE);
      android.app.KeyguardManager km = (android.app.KeyguardManager) act.getSystemService(Context.KEYGUARD_SERVICE);
      int stay = Settings.Global.getInt(act.getContentResolver(), Settings.Global.STAY_ON_WHILE_PLUGGED_IN, 0);
      JSONObject o = new JSONObject();
      o.put("owner", act.isOwner());
      o.put("kiosk", Kiosk.enabled(act));
      // As device owner every step is applied silently at start-up (MainActivity.lockdown), so each one reports
      // Done or an error; no step asks the user to open an Android screen.
      boolean owner = act.isOwner();
      boolean lockOff = owner ? act.getSharedPreferences("hub", Context.MODE_PRIVATE).getBoolean("keyguardOff", false)
          : km != null && !km.isDeviceSecure();
      JSONArray a = new JSONArray();
      a.put(item("home", "ClaudeOS is the home screen", "Home always comes back here, and it opens when the tablet starts.", owner || isHome(), false));
      a.put(item("guard", "Accessibility permission", "Turn on ClaudeOS under Accessibility, so it can close the pull-down bar and the recents screen the moment they appear.", guardOn(), false));
      a.put(item("wifi", "Wi-Fi list allowed", "Network names only show up for apps with location access.", wifiPerm, false));
      a.put(item("location", "Location is on", "Needed for Wi-Fi scanning. Nothing uses your location.", lm != null && lm.isLocationEnabled(), false));
      a.put(item("brightness", "Brightness control", "Lets ClaudeOS dim the whole screen, e.g. at night.", owner || Settings.System.canWrite(act), false));
      a.put(item("awake", "Stay awake while charging", "Keeps the tablet awake while it's plugged in.", stay != 0, false));
      a.put(item("battery", "Never put ClaudeOS to sleep", "Stops the tablet pausing ClaudeOS to save battery.", pm != null && pm.isIgnoringBatteryOptimizations(act.getPackageName()), false));
      a.put(item("lock", "No screen lock", "Set Screen lock to None, so ClaudeOS never sits behind a lock screen.", lockOff, false));
      a.put(item("keyboard", "ClaudeOS Keyboard is the tablet's keyboard", "ClaudeOS Keyboard types in every app.", hub.kiosk.ime.ImeSettings.isDefault(act), true));
      o.put("items", a);
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  /**
   * Retry a checklist item. As device owner the steps are applied silently again (no Android screen), so this only
   * re-runs the owner setup. Without device owner it opens whichever Android prompt or screen finishes the item.
   */
  @JavascriptInterface public String fix(String id) {
    if (!allowed) return DENIED;
    if (act.isOwner()) { act.runOnUiThread(act::lockdown); return OK; }
    final String pkgUri = "package:" + act.getPackageName();
    act.runOnUiThread(() -> {
      switch (id) {
        case "home": act.requestHomeRole(); break;
        case "wifi": act.requestWifiPermissions(); break;
        case "guard": act.openAndroid(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); break;
        case "restricted": act.openAndroid(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse(pkgUri))); break;
        case "location": act.openAndroid(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)); break;
        case "brightness": act.openAndroid(new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, android.net.Uri.parse(pkgUri))); break;
        case "awake": act.openAndroid(new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)); break;
        case "battery": act.openAndroid(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, android.net.Uri.parse(pkgUri))); break;
        case "lock": act.openAndroid(new Intent("android.app.action.SET_NEW_PASSWORD")); break;
        case "keyboard": act.openAndroid(new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)); break;
        case "wifiPanel": act.openAndroid(new Intent(Settings.Panel.ACTION_WIFI)); break;
        default: break;
      }
    });
    return OK;
  }

  /** Switch the kiosk guard on or off (off = the pull-down bar and recents work normally). */
  @JavascriptInterface public String setKiosk(boolean on) {
    if (!allowed) return DENIED;
    Kiosk.setEnabled(act, on);
    return OK;
  }

  /** Claude Home's background colour ("#rrggbb"), for the strip that covers Android's status bar. */
  @JavascriptInterface public String setTopColor(String hex) {
    if (!allowed) return DENIED;
    try { MainActivity.setTopColor(android.graphics.Color.parseColor(hex)); return OK; } catch (Exception e) { return err(e.toString()); }
  }

  /** The sidebar's colour, its divider's colour and its right edge in screen pixels, so the strip matches the page. */
  @JavascriptInterface public String setTopRail(String rail, String line, int px) {
    if (!allowed) return DENIED;
    try { Guard.setRail(android.graphics.Color.parseColor(rail), android.graphics.Color.parseColor(line), px); return OK; }
    catch (Exception e) { return err(e.toString()); }
  }

  /** What's along the top edge, as "x0,x1,#rrggbb;..." in screen pixels, so the strip mirrors the page exactly. */
  @JavascriptInterface public String setTopBand(String runs) {
    if (!allowed) return DENIED;
    try {
      String[] parts = runs.split(";");
      int[][] out = new int[parts.length][];
      for (int i = 0; i < parts.length; i++) {
        String[] f = parts[i].split(",");
        out[i] = new int[] { Integer.parseInt(f[0].trim()), Integer.parseInt(f[1].trim()), android.graphics.Color.parseColor(f[2].trim()) };
      }
      Guard.setBand(out);
      return OK;
    } catch (Exception e) { return err(e.toString()); }
  }

  /** How tall the strip over Android's status bar is, in screen pixels (0 when it isn't up). */
  @JavascriptInterface public String topInset() {
    if (!allowed) return DENIED;
    return "{\"px\":" + Guard.stripHeight() + "}";
  }

  /**
   * How far down from the top Android itself takes a quick swipe (its status bar's gesture band), in screen
   * pixels; the strip's height instead when Desk mode's strip is up. The pull-down's handle sits below this.
   */
  @JavascriptInterface public String topGestureInset() {
    if (!allowed) return DENIED;
    return "{\"px\":" + Math.max(Guard.stripHeight(), MainActivity.topBandPx()) + "}";
  }

  /**
   * How far up from the bottom Android itself takes a swipe up (its navigation bar's gesture band), in screen pixels;
   * Desk mode's bottom strip's height instead when that strip is up. The switcher's handle sits above this.
   */
  @JavascriptInterface public String bottomGestureInset() {
    if (!allowed) return DENIED;
    return "{\"px\":" + Math.max(Guard.bottomHeight(), MainActivity.bottomBandPx()) + "}";
  }

  /** What Desk mode's helper saw lately (event type, app, window class): for diagnosing the pull-down. */
  @JavascriptInterface public String guardLog() {
    if (!allowed) return DENIED;
    synchronized (Guard.recent) { return new JSONArray(Guard.recent).toString(); }
  }

  // ---------- power and recovery ----------
  @JavascriptInterface public String reboot() {
    if (!allowed) return DENIED;
    if (!act.isOwner()) return err("Finish Desk mode setup first.");
    try { dpm().reboot(admin()); return OK; } catch (Exception e) { return err(e.toString()); }
  }

  /** The power menu's Turn off screen: Android's lock (device admin force-lock). The keyguard is off, so the power button wakes straight to ClaudeOS. */
  @JavascriptInterface public String screenOff() {
    if (!allowed) return DENIED;
    if (!act.isOwner()) return err("Finish Desk mode setup first.");
    try { dpm().lockNow(); return OK; } catch (Exception e) { return err(e.toString()); }
  }

  /** Unpin and open Android's Settings; pressing Home (or the app restarting) locks it down again. */
  @JavascriptInterface public String maintenance() {
    if (!allowed) return DENIED;
    act.runOnUiThread(act::maintenance);
    return OK;
  }

  // ---------- silent self-update (device owner only; see Updater) ----------
  /** {status: "not owner" | "up to date" | "updating" | "busy" | "error", ...}: installs a newer build from the Hub server. */
  @JavascriptInterface public String updateCheck() {
    if (!allowed) return DENIED;
    return Updater.check(act, act.serverOrigin());
  }

  /** The update check only (Updater.available): the installed build and the newest one, and nothing is installed. */
  @JavascriptInterface public String updateAvailable() {
    if (!allowed) return DENIED;
    return Updater.available(act, act.serverOrigin());
  }

  // ---------- voice (see VoiceService, VoiceSpeaker, android/VOICE.md) ----------
  boolean isAllowed() { return allowed; }

  /** The Hub page has started (index.html's hubBooted): the native start watchdog can stand down. */
  @JavascriptInterface public void booted() { if (allowed) act.pageBooted(); }

  /** {permission, wake, mode, speaking, error, code}: is "Hey Claude" on, and what the microphone is doing now.
   *  error (the message, for the log) and code (device.ts VoiceReason) are there only after a failure. */
  @JavascriptInterface public String voice() {
    if (!allowed) return DENIED;
    try {
      JSONObject o = new JSONObject();
      o.put("permission", VoiceService.micAllowed(act));
      o.put("wake", VoiceService.wakeOn(act));
      o.put("mode", VoiceService.mode().name().toLowerCase());
      o.put("speaking", VoiceSpeaker.speaking());
      String e = VoiceService.lastError();
      if (e != null) o.put("error", e);
      String c = VoiceService.lastCode();
      if (c != null) o.put("code", c);
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  /** A failed start: {ok:false, reason} with the code the page turns into a plain line. */
  private static String notOk(String code) { return "{\"ok\":false,\"reason\":\"" + (code == null ? "unknown" : code) + "\"}"; }

  /** The microphone permission is there. As device owner a missing grant is re-applied silently (no Android dialog). */
  private boolean micReady() { return VoiceService.micAllowed(act) || act.grantMicSilently(); }

  /** Switch the wake word on or off. On without the microphone permission: as owner it is re-granted, else Android asks first. */
  @JavascriptInterface public String voiceSetWake(boolean on) {
    if (!allowed) return DENIED;
    VoiceService.prefs(act).edit().putBoolean("voiceWake", on).apply();
    if (!on) {
      if (VoiceService.mode() == VoiceService.Mode.WAKE) act.runOnUiThread(() -> VoiceService.stop(act));
      return OK;
    }
    if (!micReady()) {
      if (act.isOwner()) return notOk("no_mic");
      act.runOnUiThread(act::requestMicPermission);
      return "{\"ok\":true,\"asking\":true}";
    }
    return VoiceService.start(act, 0) ? OK : notOk(VoiceService.lastCode());
  }

  /** Listen now, without the wake word (tap to talk, or a follow-up after Claude speaks). Listening starts with a
   *  "listening" state event (VoiceService.beginRequest / startListen); a failure says why in reason. */
  @JavascriptInterface public String voiceListen(int silenceMs) {
    if (!allowed) return DENIED;
    if (!micReady()) {
      if (!act.isOwner()) act.runOnUiThread(act::requestMicPermission);
      return notOk("no_mic");
    }
    int ms = Math.max(1500, Math.min(15000, silenceMs));
    if (VoiceService.mode() == VoiceService.Mode.OFF) return VoiceService.start(act, ms) ? OK : notOk(VoiceService.lastCode());
    VoiceService.listen(ms);
    return OK;
  }

  @JavascriptInterface public String voiceCancel() {
    if (!allowed) return DENIED;
    VoiceService.cancel();
    return OK;
  }

  @JavascriptInterface public String speak(String text, String id) {
    if (!allowed) return DENIED;
    if (text == null || text.trim().isEmpty()) return err("empty");
    VoiceSpeaker.get(act).say(text, id == null ? "" : id, false);
    return OK;
  }

  @JavascriptInterface public String stopSpeaking() {
    if (!allowed) return DENIED;
    VoiceSpeaker.stopNow();
    return OK;
  }

  /** {ready, voice, rate, voices:[{id, label, locale, quality, installed, current}]}: only voices that work offline. */
  @JavascriptInterface public String voices() {
    if (!allowed) return DENIED;
    return VoiceSpeaker.get(act).voicesJson();
  }

  /** voice: an id from voices() ("" = automatic), or null to leave it; rate 0.5–2 (1 = normal), 0 to leave it. */
  @JavascriptInterface public String setVoice(String voice, double rate) {
    if (!allowed) return DENIED;
    VoiceSpeaker.get(act).setOptions(voice, rate);
    return OK;
  }

  /** Which recogniser writes down requests: {onDevice, onDeviceEnglish, standard, cloud, using, error}. Re-checks in the background. */
  @JavascriptInterface public String voiceStt() {
    if (!allowed) return DENIED;
    VoiceStt.probe(act);
    return VoiceService.sttJson().toString();
  }

  /** "Use Google speech recognition" (online; what you say after "Hey Claude" goes to Google). Off by default. */
  @JavascriptInterface public String voiceSetCloudStt(boolean on) {
    if (!allowed) return DENIED;
    VoiceService.prefs(act).edit().putBoolean("voiceCloudStt", on).apply();
    return OK;
  }

  /** Ask Android to download its on-device English speech pack (Android shows the progress). */
  @JavascriptInterface public String voiceSttDownload() {
    if (!allowed) return DENIED;
    VoiceStt.download(act);
    return OK;
  }

  /** What the wake word recogniser heard lately and the mic level: Settings' "Last heard" readout. Text only, nothing recorded. */
  @JavascriptInterface public String voiceDiag() {
    if (!allowed) return DENIED;
    return VoiceService.diagJson();
  }

  /** "Prefer natural voices when online": Automatic then uses Google's network voices (the text goes to Google). Off by default. */
  @JavascriptInterface public String setVoiceNatural(boolean on) {
    if (!allowed) return DENIED;
    VoiceSpeaker.get(act).setNatural(on);
    return OK;
  }

  /** Spoken language: a BCP-47 tag (e.g. "fr", "en-GB"); "" = the tablet's language. Drops a chosen voice of another language. */
  @JavascriptInterface public String setVoiceLanguage(String tag) {
    if (!allowed) return DENIED;
    VoiceSpeaker.get(act).setLanguage(tag);
    return OK;
  }

  /** Voice style: pitch 0.8 (calmer) to 1.2 (brighter), 1 = normal. */
  @JavascriptInterface public String setVoicePitch(double pitch) {
    if (!allowed) return DENIED;
    VoiceSpeaker.get(act).setPitch(pitch);
    return OK;
  }

  /** Say `text` once with voice `id` ("" = the current choice), without saving it: for Settings' samples. {ok, kind: natural|device} */
  @JavascriptInterface public String previewVoice(String id, String text) {
    if (!allowed) return DENIED;
    if (text == null || text.trim().isEmpty()) return err("empty");
    String kind = VoiceSpeaker.get(act).say(text, "preview-" + System.currentTimeMillis(), false, id == null ? "" : id);
    return kind == null ? err("no voice") : "{\"ok\":true,\"kind\":\"" + kind + "\"}";
  }

  // ---------- the Apps screen: Android apps Claude Home may open (Launcher.java) ----------

  /** Every app on the tablet with a launcher icon: [{id, name, icon (96px PNG data URL)}]. For the picker. */
  @JavascriptInterface public String launchableApps() {
    if (!allowed) return DENIED;
    try { return Launcher.launchable(act); } catch (Exception e) { return err(e.toString()); }
  }

  /** The apps the user chose, in order: [{id, name, icon}]. */
  @JavascriptInterface public String allowedApps() {
    if (!allowed) return DENIED;
    try { return Launcher.allowed(act); } catch (Exception e) { return err(e.toString()); }
  }

  /** Saves the chosen list (a JSON array of package names); as device owner also updates the lock task allowlist. */
  @JavascriptInterface public String setAllowedApps(String json) {
    if (!allowed) return DENIED;
    try { Launcher.setAllowed(act, json); return OK; } catch (Exception e) { return err(e.toString()); }
  }

  /** Opens an app from the chosen list; anything else is refused. */
  @JavascriptInterface public String launchApp(String pkg) {
    if (!allowed) return DENIED;
    try { String why = Launcher.launch(act, pkg); return why == null ? OK : err(why); } catch (Exception e) { return err(e.toString()); }
  }

  // ---------- the Browser app's pages (BrowserView.java) ----------
  // Each browser tab is a native WebView laid over the Browser app's content area. x, y, w, h are screen pixels
  // relative to the Claude Home page. Calls return at once; the work runs on the UI thread and what happens comes
  // back as window.hubBrowser({tab, type, ...}).
  // Claude control: the page asks with a request id (req) and the answer comes back as window.hubBrowser({type: 'claude', req, ...}).
  @JavascriptInterface public String browserReadPage(String tabId, String req) { return browser(b -> b.readPage(tabId, req)); }
  @JavascriptInterface public String browserClick(String tabId, String req, String ref) { return browser(b -> b.click(tabId, req, ref)); }
  @JavascriptInterface public String browserType(String tabId, String req, String ref, String text) { return browser(b -> b.type(tabId, req, ref, text)); }
  @JavascriptInterface public String browserScreenshot(String tabId, String req) { return browser(b -> b.screenshot(tabId, req)); }

  private String browser(java.util.function.Consumer<BrowserView> fn) {
    if (!allowed) return DENIED;
    BrowserView b = BrowserView.get();
    if (b == null) return err("no browser");
    b.post(() -> fn.accept(b));
    return OK;
  }

  @JavascriptInterface public String browserShow(String tabId, String url, int x, int y, int w, int h) { return browser(b -> b.show(tabId, url, x, y, w, h)); }
  @JavascriptInterface public String browserHide() { return browser(BrowserView::hide); }
  /** Claude Home is drawing over the content area (control center, switcher, a sheet, the keyboard): hide meanwhile. */
  @JavascriptInterface public String browserCover(boolean on) { return browser(b -> b.cover(on)); }
  @JavascriptInterface public String browserNavigate(String tabId, String url) { return browser(b -> b.navigate(tabId, url)); }
  @JavascriptInterface public String browserBack(String tabId) { return browser(b -> b.back(tabId)); }
  @JavascriptInterface public String browserForward(String tabId) { return browser(b -> b.forward(tabId)); }
  @JavascriptInterface public String browserReload(String tabId) { return browser(b -> b.reload(tabId)); }
  @JavascriptInterface public String browserStop(String tabId) { return browser(b -> b.stop(tabId)); }
  @JavascriptInterface public String browserClose(String tabId) { return browser(b -> b.close(tabId)); }
  /** Cookies, storage and cache of visited sites; Claude Home's own storage is kept. */
  @JavascriptInterface public String browserClearData() { return browser(BrowserView::clearData); }

  // ---------- the Browser app: the rest of its features (BrowserView, BrowserDownloads, BrowserFiles) ----------
  /** A tab's kind, before its page exists: private (no storage kept, cookies removed on close) and desktop. */
  @JavascriptInterface public String browserConfigure(String tabId, boolean priv, boolean desktop) { return browser(b -> b.configure(tabId, priv, desktop)); }
  @JavascriptInterface public String browserDesktop(String tabId, boolean on) { return browser(b -> b.desktop(tabId, on)); }
  @JavascriptInterface public String browserFind(String tabId, String query) { return browser(b -> b.find(tabId, query)); }
  @JavascriptInterface public String browserFindStep(String tabId, boolean forward) { return browser(b -> b.findStep(tabId, forward)); }
  @JavascriptInterface public String browserFindClose(String tabId) { return browser(b -> b.findClose(tabId)); }
  /** step: 1 bigger, -1 smaller, 0 back to the fitted page. */
  @JavascriptInterface public String browserZoom(String tabId, int step) { return browser(b -> b.zoom(tabId, step)); }
  @JavascriptInterface public String browserReader(String tabId) { return browser(b -> b.reader(tabId)); }
  @JavascriptInterface public String browserSnapshot(String tabId) { return browser(b -> b.snapshot(tabId)); }
  @JavascriptInterface public String browserShare(String title, String url) { return browser(b -> b.share(title, url)); }
  @JavascriptInterface public String browserCopy(String text) { return browser(b -> b.copy(text)); }
  /** The long-press sheet: action is newtab, copy, share, download (a link) or save (an image). */
  @JavascriptInterface public String browserContextAction(String tabId, String action, String url, String image) { return browser(b -> b.contextAction(tabId, action, url, image)); }
  @JavascriptInterface public String browserOpenFile(String uri, String mime) { return browser(b -> b.openFile(uri, mime)); }
  @JavascriptInterface public String browserShareFile(String uri, String mime) { return browser(b -> b.shareFile(uri, mime)); }
  @JavascriptInterface public String browserDownloadRemove(long id, String uri) { return browser(b -> b.downloads.remove(id, uri)); }
  /** The state of downloads the page holds (a comma list of ids), now: a JSON array. */
  @JavascriptInterface public String browserDownloadsInfo(String ids) {
    if (!allowed) return DENIED;
    BrowserView b = BrowserView.get();
    return b == null ? "[]" : b.downloads.info(ids);
  }
  /** The files the Browser saved (its downloads and saved pictures): {bytes, count}. */
  @JavascriptInterface public String browserDownloadsSize() {
    if (!allowed) return DENIED;
    try { return BrowserDownloads.savedJson(act); } catch (Exception e) { return err(e.toString()); }
  }
  /** kind: files, camera, photo (data = a JPEG data URL, name), or cancel. Answers a page's file chooser. */
  @JavascriptInterface public String browserChooseFile(String tabId, String kind, String data, String name) { return browser(b -> b.chooseFile(tabId, kind, data, name)); }
  /** The page's answer to a permission ask (camera, microphone, location). */
  @JavascriptInterface public String browserPermission(String reqId, boolean allow) { return browser(b -> b.answerPermission(reqId, allow)); }
  /** A link another app sent to Claude Home (VIEW intent), once: {url} or {url: ""}. */
  @JavascriptInterface public String browserIncoming() {
    if (!allowed) return DENIED;
    return "{\"url\":" + JSONObject.quote(BrowserView.takeIncoming()) + "}";
  }
  /**
   * A link from a ClaudeOS message (the Claude page's tap): a new tab of the Browser app. Hub origin only; http(s) only,
   * at most 2048 characters; the Browser's own rules apply (plain http upgraded unless it is the Hub or a home address).
   */
  @JavascriptInterface public String browserOpenUrl(String url) {
    if (!allowed) return DENIED;
    if (url == null || url.isEmpty() || url.length() > 2048) return err("bad link");
    BrowserView b = BrowserView.get();
    if (b == null) return err("no browser");
    return b.offer(url) == null ? err("link not allowed") : OK;
  }

  // ---------- Claude chats on the tablet's own Claude CLI (cli/ClaudeCli, apps/claude/web/native.ts) ----------
  /** Starts signing the CLI in (download on first use, `claude auth login`, then its status). Steps reach the page as
   *  window.hubCliSignin (core/web/cli-signin.ts). */
  @JavascriptInterface public String cliSigninStart() {
    if (!allowed) return DENIED;
    return hub.kiosk.cli.ClaudeCli.startSignin(act) ? OK : err("a sign-in is running");
  }
  /** {"signedIn":1|0|-1,"busy":bool}. check: also runs `claude auth status` now (the result comes as a "status" step). */
  @JavascriptInterface public String cliAuthState(boolean check) {
    if (!allowed) return DENIED;
    return hub.kiosk.cli.ClaudeCli.authState(act, check);
  }
  /** The sign-in sheet's code for the waiting `claude auth login`. An empty code means "use the clipboard". Never logged or kept. */
  @JavascriptInterface public String cliSigninCode(String code) {
    if (!allowed) return DENIED;
    String r = hub.kiosk.cli.ClaudeCli.sendCode(act, code);
    return r == null ? OK : err(r);
  }
  /** The sign-in sheet's Paste, {"text":...}. Only while a login takes a code. Never logged or kept. */
  @JavascriptInterface public String cliSigninClipboard() {
    if (!allowed) return DENIED;
    StringBuilder text = new StringBuilder();
    String r = hub.kiosk.cli.ClaudeCli.clipboardCode(act, text);
    return r == null ? "{\"text\":" + JSONObject.quote(text.toString()) + "}" : err(r);
  }
  /** {"left":s}, the seconds left for a login that takes a code, or -1 when none runs. */
  @JavascriptInterface public String cliSigninState() {
    if (!allowed) return DENIED;
    return "{\"left\":" + hub.kiosk.cli.ClaudeCli.secondsLeft() + "}";
  }
  /**
   * One message to the tablet's own Claude CLI. sessionId '' starts a new chat. model: haiku, sonnet or opus (anything
   * else is haiku). Events come back as window.hubClaudeNative(line). The text is never logged.
   */
  @JavascriptInterface public String claudeSend(String text, String sessionId, String model) {
    if (!allowed) return DENIED;
    if (text == null || text.trim().isEmpty()) return err("empty");
    String m = "sonnet".equals(model) || "opus".equals(model) ? model : "haiku";
    hub.kiosk.cli.ClaudeCli.turn(act, text, sessionId, m);
    return OK;
  }
  /** Stops the running chat process. */
  @JavascriptInterface public String claudeStop() {
    if (!allowed) return DENIED;
    hub.kiosk.cli.ClaudeCli.stopChat();
    return OK;
  }
  /**
   * Settings → Usage: asks the tablet's own Claude CLI for the plan limits (ClaudeCli.usageCheck). The answer comes back
   * as window.hubClaudeNative lines. ClaudeOS reads no token: the CLI fetches the limits with its own sign-in.
   */
  @JavascriptInterface public String claudeUsageCheck() {
    if (!allowed) return DENIED;
    return hub.kiosk.cli.ClaudeCli.usageCheck(act) ? OK : err("a usage check already runs");
  }

  // ---------- small files the page keeps in the app's own files folder (files/page/<name>.json) ----------
  // The WebView's localStorage writes reach disk a few seconds late, and are lost when the app is closed before that.
  // These files are written at once (fsync, then rename), so they survive a force-stop. Only the names below; the text
  // is never logged.
  private static final Set<String> PAGE_FILES = new HashSet<>(Arrays.asList("native-chat"));
  private static final int PAGE_FILE_MAX = 1 << 20;
  private java.io.File pageFile(String name) { return new java.io.File(new java.io.File(act.getFilesDir(), "page"), name + ".json"); }
  /** {"ok":true} once the text is on disk. */
  @JavascriptInterface public String pageFileWrite(String name, String text) {
    if (!allowed) return DENIED;
    if (!PAGE_FILES.contains(name)) return err("unknown file");
    if (text == null || text.length() > PAGE_FILE_MAX) return err("too big");
    java.io.File f = pageFile(name), tmp = new java.io.File(f.getPath() + ".tmp");
    synchronized (PAGE_FILES) {
      try {
        java.io.File dir = f.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) return err("no folder");
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(tmp)) {
          out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
          out.getFD().sync();
        }
        if (!tmp.renameTo(f)) return err("rename failed");
        return OK;
      } catch (Exception e) { return err(e.toString()); }
    }
  }
  /** {"text":...}, or {"text":null} when the file is not there. */
  @JavascriptInterface public String pageFileRead(String name) {
    if (!allowed) return DENIED;
    if (!PAGE_FILES.contains(name)) return err("unknown file");
    java.io.File f = pageFile(name);
    synchronized (PAGE_FILES) {
      if (!f.isFile()) return "{\"text\":null}";
      try {
        byte[] b = java.nio.file.Files.readAllBytes(f.toPath());
        return "{\"text\":" + JSONObject.quote(new String(b, java.nio.charset.StandardCharsets.UTF_8)) + "}";
      } catch (Exception e) { return err(e.toString()); }
    }
  }

  /** The page's answer to a Browser page's alert, confirm or prompt (a ClaudeOS sheet): ok, and the typed text. */
  @JavascriptInterface public String browserDialog(String dialogId, boolean ok, String text) { return browser(b -> b.answerDialog(dialogId, ok, text)); }
  /** The Google sign-in panel's Done: finishes Chrome's side sheet (Claude Home comes back to the front). */
  @JavascriptInterface public String browserChromeDone() { return browser(BrowserView::chromeDone); }
  /** Browser settings: Google sign-in in the Chrome panel (true, the default) or in the Browser's own pages (false). */
  @JavascriptInterface public String browserSetGoogleSignin(boolean inChrome) {
    if (!allowed) return DENIED;
    BrowserView.setGoogleInChrome(act, inChrome);
    return OK;
  }
  @JavascriptInterface public String browserGoogleSignin() {
    if (!allowed) return DENIED;
    return "{\"inChrome\":" + BrowserView.googleInChrome(act) + "}";
  }

  // ---------- the camera (CameraView.java): a live preview under the page, and photos to the PC ----------
  // facing "front" or "back"; x, y, w, h: the preview's rectangle in device pixels (the page's getBoundingClientRect × dpr).
  @JavascriptInterface public String cameraOpen(String facing, int x, int y, int w, int h) {
    if (!allowed) return DENIED;
    return CameraView.of(act, web, this).open(facing, x, y, w, h);
  }
  @JavascriptInterface public String cameraMove(int x, int y, int w, int h) {
    if (!allowed) return DENIED;
    CameraView.of(act, web, this).move(x, y, w, h);
    return OK;
  }
  @JavascriptInterface public String cameraClose() {
    if (!allowed) return DENIED;
    CameraView.of(act, web, this).close();
    return OK;
  }
  /** Takes a photo and uploads it to the PC; 'captured' or 'error' follows on window.hubCamera with this id.
   *  sound: the page allows the shutter click (chimes on, not Do Not Disturb or quiet hours). */
  @JavascriptInterface public String cameraCapture(String id, boolean sound) {
    if (!allowed) return DENIED;
    return CameraView.of(act, web, this).capture(id, sound);
  }

  // ---------- Claude Keyboard (ime/ClaudeKeyboard.java): the tablet's keyboard in every app ----------
  /** {enabled, isDefault, canSet}: whether Claude Keyboard is switched on, is the default, and this app may change that. */
  @JavascriptInterface public String keyboardStatus() {
    if (!allowed) return DENIED;
    try {
      JSONObject o = new JSONObject();
      o.put("enabled", ImeSettings.enabled(act));
      o.put("isDefault", ImeSettings.isDefault(act));
      o.put("canSet", ImeSettings.canSet(act));
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  /** Makes Claude Keyboard the tablet's keyboard (needs WRITE_SECURE_SETTINGS, or device owner). */
  @JavascriptInterface public String keyboardSetDefault() {
    if (!allowed) return DENIED;
    String e = ImeSettings.makeDefault(act);
    return e == null ? OK : err(e);
  }

  /** Forgets the words Claude Keyboard learned while typing. */
  @JavascriptInterface public String keyboardClearLearned() {
    if (!allowed) return DENIED;
    ImeSettings.clearLearned(act);
    return OK;
  }

  /** {suggestions, keySounds}: the keyboard's word suggestions (on by default) and key click sounds (off by default). */
  @JavascriptInterface public String keyboardPrefs() {
    if (!allowed) return DENIED;
    try {
      JSONObject o = new JSONObject();
      o.put("suggestions", ImeSettings.suggestions(act));
      o.put("keySounds", ImeSettings.keySounds(act));
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  /** name: "suggestions" or "keySounds" (anything else is refused). */
  @JavascriptInterface public String keyboardSetPref(String name, boolean on) {
    if (!allowed) return DENIED;
    if (!ImeSettings.setPref(act, name, on)) return err("unknown keyboard setting");
    return OK;
  }

  // ---------- wireless debugging (AdbWifi.java): ADB over Wi-Fi, so nobody opens developer options ----------
  /** {on, canControl, needsGrant, ip, port, keep}. needsGrant: the PC must grant WRITE_SECURE_SETTINGS once. */
  @JavascriptInterface public String adbWifi() {
    if (!allowed) return DENIED;
    try {
      boolean can = AdbWifi.canControl(act);
      boolean on = AdbWifi.isOn(act);
      JSONObject o = new JSONObject();
      o.put("on", on);
      o.put("canControl", can);
      o.put("needsGrant", !can);
      o.put("ip", AdbWifi.ip(act));
      if (on) AdbWifi.findPort(act);   // listens for the service's announcement (no-op once running)
      o.put("port", on ? AdbWifi.port() : "");
      o.put("keep", AdbWifi.keep(act));
      return o.toString();
    } catch (Exception e) { return err(e.toString()); }
  }

  /** Switches wireless debugging on or off. Without the one-time grant: {ok:false, needsGrant:true}. */
  @JavascriptInterface public String setAdbWifi(boolean on) {
    if (!allowed) return DENIED;
    String e = AdbWifi.setUser(act, on);
    if (e == null) return OK;
    if ("needsGrant".equals(e)) return "{\"ok\":false,\"needsGrant\":true}";
    return err(e);
  }

  /** "Keep on after restart": re-enable wireless debugging at start-up and after Wi-Fi changes. */
  @JavascriptInterface public String setAdbWifiKeep(boolean keep) {
    if (!allowed) return DENIED;
    AdbWifi.setKeep(act, keep);
    return OK;
  }
}