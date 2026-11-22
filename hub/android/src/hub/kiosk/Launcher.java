package hub.kiosk;

import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The Apps screen's Android side: which apps on the tablet Claude Home may open, and opening them.
 * The user's list is kept in SharedPreferences ("launcher" / "allowed", a JSON array of package names).
 * As device owner, the lock task allowlist is Claude Home plus that list, so those apps can run while
 * the tablet stays locked down. Nothing outside the list can be launched from the page.
 *
 * While an allowed app is in front, BackButton draws a small floating button that brings Claude Home back.
 */
final class Launcher {
  private Launcher() {}

  private static final String PREFS = "launcher", KEY = "allowed";
  private static final int ICON_PX = 96;

  private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

  /** Package -> label for every app with a launcher activity, except Claude Home itself. Needs the <queries> entry. */
  private static Map<String, ResolveInfo> launchers(Context c) {
    PackageManager pm = c.getPackageManager();
    Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
    Map<String, ResolveInfo> out = new LinkedHashMap<>();
    for (ResolveInfo ri : pm.queryIntentActivities(main, 0)) {
      String pkg = ri.activityInfo.packageName;
      if (pkg.equals(c.getPackageName()) || out.containsKey(pkg)) continue;
      out.put(pkg, ri);
    }
    return out;
  }

  private static String iconUrl(Context c, ResolveInfo ri) {
    try {
      Drawable d = ri.loadIcon(c.getPackageManager());
      Bitmap b = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
      Canvas cv = new Canvas(b);
      d.setBounds(0, 0, ICON_PX, ICON_PX);
      d.draw(cv);
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      b.compress(Bitmap.CompressFormat.PNG, 100, bytes);
      b.recycle();
      return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    } catch (Exception e) {
      return "";
    }
  }

  private static JSONObject entry(Context c, String pkg, ResolveInfo ri) throws Exception {
    return new JSONObject()
        .put("id", pkg)
        .put("name", String.valueOf(ri.loadLabel(c.getPackageManager())))
        .put("icon", iconUrl(c, ri));
  }

  /** The saved list, in order. */
  static List<String> allowedIds(Context c) {
    List<String> ids = new ArrayList<>();
    try {
      JSONArray a = new JSONArray(prefs(c).getString(KEY, "[]"));
      for (int i = 0; i < a.length(); i++) ids.add(a.getString(i));
    } catch (Exception ignored) { }
    return ids;
  }

  /** [{id, name, icon}] for every launchable app, by name. */
  static String launchable(Context c) throws Exception {
    JSONArray out = new JSONArray();
    for (Map.Entry<String, ResolveInfo> e : launchers(c).entrySet()) out.put(entry(c, e.getKey(), e.getValue()));
    return out.toString();
  }

  /** [{id, name, icon}] for the allowed apps still installed, in the user's order. */
  static String allowed(Context c) throws Exception {
    Map<String, ResolveInfo> all = launchers(c);
    JSONArray out = new JSONArray();
    for (String pkg : allowedIds(c)) {
      ResolveInfo ri = all.get(pkg);
      if (ri != null) out.put(entry(c, pkg, ri));
    }
    return out.toString();
  }

  /**
   * Apps that may never join the lock task allowlist: Android Settings can reset the tablet or drop the device
   * owner, and lock task has no home or recents to leave it. Only MainActivity.maintenance() reaches Settings,
   * and it unpins first.
   */
  static final String NEVER_LOCKED = "com.android.settings";

  /** Chrome joins the allowlist only while a Google sign-in Custom Tab is open (BrowserView.openedInChrome). */
  static final String CHROME = "com.android.chrome";
  private static volatile boolean chromeForSignIn = false;

  /** Saves the list (only real launchable packages, never Settings), then updates the lock task allowlist. */
  static void setAllowed(Context c, String json) throws Exception {
    JSONArray in = new JSONArray(json);
    Map<String, ResolveInfo> all = launchers(c);
    JSONArray keep = new JSONArray();
    List<String> seen = new ArrayList<>();
    for (int i = 0; i < in.length(); i++) {
      String pkg = in.optString(i, "");
      if (all.containsKey(pkg) && !pkg.equals(NEVER_LOCKED) && !seen.contains(pkg)) { seen.add(pkg); keep.put(pkg); }
    }
    prefs(c).edit().putString(KEY, keep.toString()).apply();
    applyLockTask(c);
  }

  /** Turns Chrome's place on the allowlist on or off (sign-in only), then updates the allowlist. */
  static void setChromeForSignIn(Context c, boolean on) {
    chromeForSignIn = on;
    applyLockTask(c);
  }

  /** True when this package may run inside lock task (Claude Home, the allowed apps, Chrome during sign-in). */
  static boolean lockAllowed(Context c, String pkg) {
    if (pkg == null || pkg.equals(NEVER_LOCKED)) return false;
    if (pkg.equals(c.getPackageName())) return true;
    if (pkg.equals(CHROME)) return chromeForSignIn;
    return allowedIds(c).contains(pkg);
  }

  /** As device owner: lock task may run Claude Home and the allowed apps. A no-op otherwise. */
  static void applyLockTask(Context c) {
    DevicePolicyManager dpm = (DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE);
    if (dpm == null || !dpm.isDeviceOwnerApp(c.getPackageName())) return;
    List<String> pkgs = new ArrayList<>();
    pkgs.add(c.getPackageName());
    pkgs.addAll(allowedIds(c));
    if (chromeForSignIn && !pkgs.contains(CHROME)) pkgs.add(CHROME);
    dpm.setLockTaskPackages(AdminReceiver.component(c), pkgs.toArray(new String[0]));
  }

  /** Opens an allowed app. Returns null when started, else the reason. */
  static String launch(Context c, String pkg) {
    if (pkg == null || !allowedIds(c).contains(pkg)) return "not allowed";
    Intent i = c.getPackageManager().getLaunchIntentForPackage(pkg);
    if (i == null) return "not installed";
    // MainActivity resets the allowlist to Claude Home alone when it sets up lock task, so set it again
    // right before leaving: an allowed app started from the locked task then stays in lock task.
    applyLockTask(c);
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    // lock task HOME only while this app is in front (its home gesture brings Claude Home back); NONE again on resume
    MainActivity.allowedAppOpening(true);
    try { c.startActivity(i); }
    catch (RuntimeException e) { MainActivity.allowedAppOpening(false); return "couldn't open"; }
    BackButton.showAfterLaunch(c);   // the floating "back to ClaudeOS" button, while this app is in front (BackButton)
    return null;
  }
}
