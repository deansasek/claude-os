package hub.kiosk.ime;

import java.util.HashMap;
import java.util.Map;

/**
 * The key layouts of Claude Keyboard. They are Claude Home's own on-screen keyboard (core/web/keyboard.ts): the same
 * rows, the same keys (⇧ ⌫ 123 ABC and a space bar), the same key widths. The number and phone pads, and the @ and
 * .com keys of email and web-address fields, are the tablet's additions for the fields that need them.
 */
final class Layouts {
  private Layouts() { }

  // the pages: letters and symbols (the web keyboard's two pages), and the number and phone pads (chosen by the field)
  static final int ALPHA = 0, NUM = 1, PHONE = 2, SYM = 3;

  // named keys: drawn by KeyboardView, not typed as text
  static final String SHIFT = "shift", DEL = "del", ENTER = "enter", SPACE = "space",
      TO_NUM = "123", TO_ALPHA = "ABC", COM = ".com", EMOJI = "emoji";

  // key widths in Claude Home's CSS px (core.css: .kb-row button 86, .wide 132, .space 420; rows gap 8)
  static final float KEY_W = 86, WIDE_W = 132, SPACE_W = 420;

  static boolean wide(String k) {
    return SHIFT.equals(k) || DEL.equals(k) || ENTER.equals(k) || TO_NUM.equals(k) || TO_ALPHA.equals(k);
  }

  /** A key's width in CSS px. */
  static float width(String k) {
    if (SPACE.equals(k)) return SPACE_W;
    return wide(k) ? WIDE_W : KEY_W;
  }

  /**
   * The rows of a page. The bottom row of the letters and symbols pages is ?123 (or ABC), emoji, the key beside the
   * space bar, the space bar, the key after it, and Enter: the field's action, or the return arrow (KeyboardView).
   * Enter is there in every field; in a multi-line field it is a new line.
   */
  static String[][] rows(int layout, boolean email, boolean url, boolean multiLine) {
    switch (layout) {
      case NUM:
        return new String[][] {
            {"1", "2", "3", DEL}, {"4", "5", "6", "-"}, {"7", "8", "9", "."}, {"+", "0", ",", ENTER}};
      case PHONE:
        return new String[][] {
            {"1", "2", "3", DEL}, {"4", "5", "6", "+"}, {"7", "8", "9", "*"}, {"-", "0", "#", ENTER}};
      case SYM:
        return new String[][] {
            {"1", "2", "3", "4", "5", "6", "7", "8", "9", "0"},
            {"@", "#", "&", "(", ")", "/", ":", ";", "?", "!"},
            {"-", "\"", "'", "_", "+", "=", "*", "%", "$", DEL},
            {TO_ALPHA, EMOJI, ",", SPACE, ".", ENTER}};
      default:
        // the key beside the space bar and the one after it: @ and .com for email, / and .com for a web address
        String beside = email ? "@" : url ? "/" : ",";
        String end = email || url ? COM : ".";
        return new String[][] {
            {"q", "w", "e", "r", "t", "y", "u", "i", "o", "p"},
            {"a", "s", "d", "f", "g", "h", "j", "k", "l", "'"},
            {SHIFT, "z", "x", "c", "v", "b", "n", "m", DEL},
            {TO_NUM, EMOJI, beside, SPACE, end, ENTER}};
    }
  }

  // long-press choices (native only): the key itself comes first, then its alternates
  private static final Map<String, String> ALTERNATES = new HashMap<>();
  static {
    alt("a", "àáâäæãåā");
    alt("c", "çćč");
    alt("e", "èéêëēėę");
    alt("i", "ìíîïī");
    alt("l", "ł");
    alt("n", "ñń");
    alt("o", "òóôöõøœō");
    alt("s", "ßśš");
    alt("u", "ùúûüū");
    alt("y", "ÿý");
    alt("z", "žźż");
    alt(".", "…");
    alt("?", "¿");
    alt("!", "¡");
    alt("-", "–—");
    alt("\"", "“”„«»");
    alt("'", "‘’‚");
    alt("$", "€£¥¢");
    alt("/", "\\");
    alt("&", "§");
  }
  private static void alt(String key, String chars) { ALTERNATES.put(key, chars); }

  /** The choices for a long press on this key, the key first; null when it has none. */
  static String alternates(String key) {
    String a = ALTERNATES.get(key);
    return a == null ? null : key + a;
  }
}
