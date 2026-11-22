package hub.kiosk;

import android.content.Context;

/** Shared kiosk state: is the guard on, and is it paused while you use Android's own settings. */
final class Kiosk {
  private Kiosk() { }
  private static volatile long pausedUntil = 0;

  static boolean paused() { return System.currentTimeMillis() < pausedUntil; }
  /** Let you use Android's screens for a while (the Hub coming back to the front ends it early). */
  static void pause(long ms) { pausedUntil = System.currentTimeMillis() + ms; Guard.refreshStrip(); }
  static void resume() { pausedUntil = 0; Guard.refreshStrip(); }

  /**
   * This tablet drops (unbinds) the accessibility helper whenever the app is updated. With
   * WRITE_SECURE_SETTINGS (granted once from the PC: adb shell pm grant hub.kiosk android.permission.WRITE_SECURE_SETTINGS)
   * the app switches it off and on again itself, which makes Android bind it afresh.
   */
  static void ensureGuard(Context c) {
    if (Guard.connected || !enabled(c)) return;
    if (((android.app.admin.DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE)).isDeviceOwnerApp(c.getPackageName())) return;
    if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
    try {
      android.content.ContentResolver r = c.getContentResolver();
      String me = c.getPackageName() + "/" + Guard.class.getName();
      String cur = android.provider.Settings.Secure.getString(r, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
      StringBuilder others = new StringBuilder();
      if (cur != null) for (String s : cur.split(":")) {
        if (s.isEmpty() || s.startsWith(c.getPackageName() + "/")) continue;
        if (others.length() > 0) others.append(':');
        others.append(s);
      }
      // off, then on again a moment later: Android only rebinds when it sees the setting really change
      android.provider.Settings.Secure.putString(r, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, others.toString());
      final String on = others.length() > 0 ? others + ":" + me : me;
      new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
        try {
          android.provider.Settings.Secure.putString(r, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, on);
          android.provider.Settings.Secure.putInt(r, android.provider.Settings.Secure.ACCESSIBILITY_ENABLED, 1);
        } catch (Exception ignored) { }
      }, 900);
    } catch (Exception ignored) { }
  }

  /**
   * Device owner, at every start (MainActivity.lockdown): the Desk mode helper is switched on silently and is the only
   * accessibility service allowed, and Claude Keyboard is the only keyboard allowed. Writes the secure settings with
   * WRITE_SECURE_SETTINGS (granted over adb), falling back to the device owner's own setter. No Android screen opens.
   */
  static void ownerSetup(Context c, android.app.admin.DevicePolicyManager d, android.content.ComponentName admin) {
    String pkg = c.getPackageName();
    try {
      d.setPermittedAccessibilityServices(admin, java.util.Collections.singletonList(pkg));
    } catch (RuntimeException e) { android.util.Log.w("HubKiosk", "permitted accessibility", e); }
    try {
      android.content.ContentResolver r = c.getContentResolver();
      String me = pkg + "/" + Guard.class.getName();
      String cur = android.provider.Settings.Secure.getString(r, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
      if (!me.equals(cur)) secure(c, d, admin, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, me);
      if (android.provider.Settings.Secure.getInt(r, android.provider.Settings.Secure.ACCESSIBILITY_ENABLED, 0) != 1) {
        secure(c, d, admin, android.provider.Settings.Secure.ACCESSIBILITY_ENABLED, "1");
      }
    } catch (Exception e) { android.util.Log.w("HubKiosk", "enable guard", e); }
    try {
      d.setPermittedInputMethods(admin, java.util.Collections.singletonList(pkg));
    } catch (RuntimeException e) { android.util.Log.w("HubKiosk", "permitted keyboards", e); }
  }

  /** A secure setting: written directly with WRITE_SECURE_SETTINGS, else through the device owner's setter. */
  private static void secure(Context c, android.app.admin.DevicePolicyManager d, android.content.ComponentName admin, String key, String value) {
    try {
      if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == android.content.pm.PackageManager.PERMISSION_GRANTED) {
        android.provider.Settings.Secure.putString(c.getContentResolver(), key, value);
        return;
      }
      d.setSecureSetting(admin, key, value);
    } catch (RuntimeException e) { android.util.Log.w("HubKiosk", "secure " + key, e); }
  }

  /**
   * An uncaught exception ends the process without Android's "ClaudeOS has stopped" dialog: nothing is reported to the
   * system's crash handler. ClaudeOS is the home screen, so Android brings it straight back.
   */
  static void quietCrashes() {
    Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
      android.util.Log.e("HubKiosk", "crash, restarting quietly", e);
      android.os.Process.killProcess(android.os.Process.myPid());
      System.exit(10);
    });
  }

  static boolean enabled(Context c) { return c.getSharedPreferences("hub", Context.MODE_PRIVATE).getBoolean("kiosk", true); }
  static void setEnabled(Context c, boolean on) { c.getSharedPreferences("hub", Context.MODE_PRIVATE).edit().putBoolean("kiosk", on).apply(); Guard.refreshStrip(); }
}
