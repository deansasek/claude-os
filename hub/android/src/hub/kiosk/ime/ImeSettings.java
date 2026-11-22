package hub.kiosk.ime;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;

import hub.kiosk.AdminReceiver;

import java.util.ArrayList;
import java.util.List;

/**
 * Makes Claude Keyboard the tablet's keyboard: enabled, and the default. Other keyboards stay installed.
 * Needs WRITE_SECURE_SETTINGS (granted over adb), or the device owner (DevicePolicyManager.setSecureSetting).
 *
 * Android 14 refuses apps targeting SDK 34+ to READ enabled_input_methods, so the enabled keyboards are listed
 * through the public InputMethodManager API instead, and the setting is written from that list.
 */
public final class ImeSettings {
  private ImeSettings() { }

  /** The keyboard's id as Android lists it, e.g. hub.kiosk/.ime.ClaudeKeyboard. */
  static String id(Context c) {
    return new ComponentName(c, ClaudeKeyboard.class).flattenToShortString();
  }

  /** This app may change the keyboard settings (WRITE_SECURE_SETTINGS, or device owner). */
  public static boolean canSet(Context c) {
    if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == PackageManager.PERMISSION_GRANTED) return true;
    return owner(c);
  }

  private static boolean owner(Context c) {
    DevicePolicyManager dpm = (DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE);
    return dpm != null && dpm.isDeviceOwnerApp(c.getPackageName());
  }

  /** The ids of the keyboards that are switched on (public API, no settings read). */
  private static List<String> enabledIds(Context c) {
    List<String> out = new ArrayList<>();
    InputMethodManager imm = (InputMethodManager) c.getSystemService(Context.INPUT_METHOD_SERVICE);
    if (imm == null) return out;
    for (InputMethodInfo info : imm.getEnabledInputMethodList()) out.add(info.getId());
    return out;
  }

  public static boolean enabled(Context c) {
    return enabledIds(c).contains(id(c));
  }

  public static boolean isDefault(Context c) {
    try {
      return id(c).equals(Settings.Secure.getString(c.getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD));
    } catch (RuntimeException e) {
      return false;   // not readable here: ensureDefault simply sets it again
    }
  }

  /** Adds Claude Keyboard to the enabled keyboards and makes it the default. Null on success, else the reason. */
  public static String makeDefault(Context c) {
    if (!canSet(c)) return "Finish Desk mode setup first.";
    try {
      String me = id(c);
      List<String> ids = enabledIds(c);
      if (!ids.contains(me)) ids.add(me);
      if (!put(c, Settings.Secure.ENABLED_INPUT_METHODS, String.join(":", ids))) return "couldn't enable ClaudeOS Keyboard";
      if (!put(c, Settings.Secure.DEFAULT_INPUT_METHOD, me)) return "couldn't make ClaudeOS Keyboard the default";
      return null;
    } catch (RuntimeException e) {
      return "couldn't change the keyboard: " + e.getClass().getSimpleName();
    }
  }

  private static boolean put(Context c, String key, String value) {
    if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == PackageManager.PERMISSION_GRANTED) {
      return Settings.Secure.putString(c.getContentResolver(), key, value);
    }
    DevicePolicyManager dpm = (DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE);
    dpm.setSecureSetting(AdminReceiver.component(c), key, value);
    return true;
  }

  /** At start-up: if this app may set the keyboard and it isn't the default yet, make it so. */
  public static void ensureDefault(Context c) {
    if (!canSet(c) || isDefault(c)) return;
    makeDefault(c);
  }

  /** Forgets the words Claude Keyboard learned while typing. */
  public static void clearLearned(Context c) {
    Words.clearLearned(c);
  }

  // ---------- the keyboard's own choices (kept with the rest of ClaudeOS's settings) ----------
  private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("hub", Context.MODE_PRIVATE); }

  /** Word suggestions above the keys. On by default. */
  public static boolean suggestions(Context c) { return prefs(c).getBoolean("keySuggestions", true); }

  /** A click with each key press (Android's key click sound). Off by default. */
  public static boolean keySounds(Context c) { return prefs(c).getBoolean("keySounds", false); }

  /** The emoji the user picked, most recent first (the defaults until something is picked). */
  public static String[] recentEmoji(Context c) {
    String raw = prefs(c).getString("emojiRecent", "");
    if (raw.isEmpty()) return Emoji.DEFAULT_RECENT;
    return raw.split("\\|");
  }

  /** Puts an emoji at the front of the recent list (30 at most). */
  public static void addRecentEmoji(Context c, String emoji) {
    List<String> list = new ArrayList<>();
    list.add(emoji);
    for (String e : recentEmoji(c)) if (!e.equals(emoji) && list.size() < Emoji.PER_PAGE) list.add(e);
    prefs(c).edit().putString("emojiRecent", String.join("|", list)).apply();
  }

  /** Sets one of the keyboard's switches by name. False if the name is not one of them. */
  public static boolean setPref(Context c, String name, boolean on) {
    String key;
    if ("suggestions".equals(name)) key = "keySuggestions";
    else if ("keySounds".equals(name)) key = "keySounds";
    else return false;
    prefs(c).edit().putBoolean(key, on).apply();
    return true;
  }
}
