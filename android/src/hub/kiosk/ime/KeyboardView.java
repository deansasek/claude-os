package hub.kiosk.ime;

import android.content.Context;
import android.media.AudioManager;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The face of Claude Keyboard, drawn on a Canvas to match Claude Home's on-screen keyboard (core/web/keyboard.ts and
 * core.css). Every measure below is in Claude Home's CSS px, scaled the way the page's stage is scaled to the screen
 * (unit()), so on the tablet the keys are the page's own size. It only reports what was pressed; ClaudeKeyboard
 * decides what that does to the text.
 */
final class KeyboardView extends View {

  interface Listener {
    void onText(String text);        // a letter, digit or symbol, already in the case shown
    void onDelete();                 // one character; held, it repeats
    void onSpace();
    void onEnter();                  // the return key (number pads, multi-line fields)
    void onDone();                   // the bar's Done: the field's action, then close
    void onCancel();                 // the bar's Cancel: close
    void onSuggestion(int index);
    void onPaste();
    void onDictate();                // the bar's Dictate: speak into the field, or stop listening if already listening
    void onCursor(int step);         // -1 left, +1 right (swiping the space bar)
  }

  // core.css .kb (padding 12px 20px 16px, 1px top border), .kb-bar, .kb-keys, .kb-row button
  private static final float STAGE_W = 1024f;          // dom.ts fitStage: the page is drawn 1024 wide
  private static final float BORDER = 1, PAD_TOP = 12, PAD_X = 20, PAD_BOTTOM = 16,
      BAR_H = 46, BAR_GAP = 12, BAR_PAD = 20, BAR_RADIUS = 12, BAR_FONT = 15, BAR_SPACING = 10,
      FIELD_PAD = 16, FIELD_FONT = 19, SUG_FONT = 17, PASTE_FONT = 14,
      KEY_H = 48, KEY_GAP = 8, KEY_RADIUS = 10, KEY_FONT = 20, SMALL_FONT = 14, MULTI_FONT = 16;
  /** The whole keyboard's height in CSS px: 1 + 12 + 46 + 12 + 4 x 48 + 3 x 8 + 16 = 303. */
  static final float HEIGHT_CSS = BORDER + PAD_TOP + BAR_H + BAR_GAP + 4 * KEY_H + 3 * KEY_GAP + PAD_BOTTOM;
  private static final float PRESS_SCALE = .94f;        // .kb-row button:active { transform: scale(.94) }

  // timings: the web's ⌫ holds 450 ms, then repeats every 70 ms; the long press and cursor swipe are native-only
  private static final long LONG_PRESS_MS = 420, REPEAT_START_MS = 450, REPEAT_MS = 70;
  private static final float SWIPE_CSS = 16, SLIP_CSS = 24, PAGE_SWIPE_CSS = 40;
  private static final long DOUBLE_TAP_MS = 350;   // two taps of ⇧ this close lock the capitals

  // what a touch on the bar hits (Touch.bar); 0..2 are the suggestions
  private static final int BAR_NONE = -1, BAR_PASTE = 10, BAR_CANCEL = 11, BAR_DONE = 12, BAR_MIC = 13;

  private static final class Key {
    final String code;
    final RectF r = new RectF();
    String glyph;              // an emoji panel key: the emoji (grid cell) or the category's icon; null otherwise
    int cat = -1;              // an emoji panel category key: its index in Emoji; -1 otherwise
    Key(String code) { this.code = code; }
  }

  private static final class Touch {
    Key key;                   // the key under the finger (null for the bar)
    int bar = BAR_NONE;        // the bar target, when the touch began on the bar
    float lastX, startX;
    Runnable task;             // the pending long press or key repeat
    boolean done, cancelled, popup, swiped, upper;
    String alts;               // the long-press choices, the key first
    int altIdx;
    String pick;               // an emoji grid cell: committed on lift, unless the finger swiped to another page
    float popLeft, popTop, popW, popX0, cellW;
  }

  private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint ink = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path path = new Path();
  private final RectF rect = new RectF();
  private final Typeface sans = Typeface.create("sans-serif", Typeface.NORMAL);
  private final Typeface sansMedium = Typeface.create("sans-serif-medium", Typeface.NORMAL);
  private final List<Key> keys = new ArrayList<>();
  private final Map<Integer, Touch> touches = new HashMap<>();
  private final RectF cancelR = new RectF(), doneR = new RectF(), fieldR = new RectF(), pasteR = new RectF();
  private final RectF[] sugR = { new RectF(), new RectF(), new RectF() };

  private Listener listener;
  private int page, rail, keyColor, line, card2, text, t3, t4, t5, clay;   // the theme's tokens (setDark)
  private final RectF micR = new RectF();
  private boolean dictationOn = true;   // off in password fields (ClaudeKeyboard)
  private boolean learnRecent = true;   // emoji typed here go to Recent; off in password fields
  private boolean dictating;            // listening now: the Dictate key reads "Listening" in clay
  private int base = Layouts.ALPHA, layout = Layouts.ALPHA;
  private boolean email, url, multiLine;
  private boolean shift;          // the ⇧ key, tapped once: the next letter is a capital
  private boolean caps;           // the ⇧ key, tapped twice: capitals stay on until ⇧ is tapped again
  private long lastShiftAt;       // when ⇧ was last tapped (a second tap within DOUBLE_TAP_MS locks)
  private boolean autoShift;      // the field capitalises here (start of a sentence)
  private boolean emojiMode;      // the keys area is the emoji panel (grid and category strip), not the letters
  private int emojiCat;           // the category shown: 0 Recent, then Emoji's categories
  private int emojiPage;          // the grid's page within the category (swipe left or right)
  private String[] suggestions = new String[0];
  private String hint;            // the field's hint, shown when there are no suggestions
  private String doneLabel = "Done";
  private String enterWord;       // the field's action word on the pads' Return key; null: the arrow
  private float u = 1;            // device px per Claude Home CSS px
  private float stageL;           // device x where the 1024-wide keyboard starts (centred)

  KeyboardView(Context c) {
    super(c);
    setDark(false);
  }

  void setListener(Listener l) { listener = l; }

  /** Shows the Dictate key (false in password fields). */
  void setDictationOn(boolean on) { dictationOn = on; invalidate(); }

  /** Whether emoji picked here are learned into Recent (not in password fields). */
  void setLearnRecent(boolean on) { learnRecent = on; }

  /** The Dictate key's state: listening (clay, "Listening") or idle. */
  void setDictating(boolean on) { dictating = on; invalidate(); }

  /** Claude Home's colours: core.css :root, and :root[data-theme="dark"]. */
  void setDark(boolean d) {
    if (d) {
      page = 0xFF141413; rail = 0xFF1B1A19; keyColor = page; line = 0xFF30302E; card2 = 0xFF2B2A27;
      text = 0xFFFAF9F5; t3 = 0xFFA6A49B; t4 = 0xFF87867F; t5 = 0xFF5E5D59; clay = 0xFFD97757;
    } else {
      page = 0xFFFAF9F5; rail = 0xFFF0EEE6; keyColor = page; line = 0xFFDEDCD1; card2 = 0xFFE8E6DC;
      text = 0xFF141413; t3 = 0xFF5E5D59; t4 = 0xFF73726B; t5 = 0xFFB0AEA5; clay = 0xFFBF5D3C;
    }
    invalidate();
  }

  /** The page the field asks for (letters, number pad, phone pad) and the field's kind. */
  void configure(int baseLayout, boolean email, boolean url, boolean multiLine) {
    base = baseLayout;
    layout = baseLayout;
    emojiMode = false;
    emojiPage = 0;
    this.email = email;
    this.url = url;
    this.multiLine = multiLine;
    relayout();
  }

  void setSuggestions(String[] s) { suggestions = s == null ? new String[0] : s; relayout(); }

  void setHint(CharSequence h) { hint = h == null || h.length() == 0 ? null : h.toString(); invalidate(); }

  /**
   * The field's action (Go, Search, Send, Next, Done): the bar's Done label, and the word on the pads' Return key.
   * Null: the bar says Done and the Return key shows the arrow.
   */
  void setDone(String label) { enterWord = label; doneLabel = label == null ? "Done" : label; relayout(); }

  void resetShift() { shift = false; caps = false; invalidate(); }

  void setAutoShift(boolean on) { if (autoShift != on) { autoShift = on; invalidate(); } }

  private boolean shiftOn() { return shift || caps || autoShift; }

  // ---------- size ----------

  /**
   * Device px per CSS px, as Claude Home's stage gets it (core/web/dom.ts fitStage): the stage is 1024 wide, grows
   * taller between 600 and 700 on squarer screens, and is scaled to fit the screen.
   */
  private float unit() {
    DisplayMetrics m = getResources().getDisplayMetrics();
    float vw = m.widthPixels / m.density, vh = m.heightPixels / m.density;
    float h = Math.max(600f, Math.min(700f, STAGE_W * vh / vw));
    float s = Math.min(vw / STAGE_W, vh / h);
    return s * m.density;
  }

  @Override protected void onMeasure(int widthSpec, int heightSpec) {
    setMeasuredDimension(MeasureSpec.getSize(widthSpec), Math.round(HEIGHT_CSS * unit()));
  }

  @Override protected void onSizeChanged(int w, int h, int ow, int oh) { relayout(); }

  private float textWidth(String s, float css, Typeface tf) {
    ink.setTypeface(tf);
    ink.setTextSize(css * u);
    return ink.measureText(s);
  }

  private float keysTop() { return (BORDER + PAD_TOP + BAR_H + BAR_GAP) * u; }

  /** Lays out the bar and the keys: the rows centred in the 984 px content box, as .kb-row does. */
  private void relayout() {
    keys.clear();
    int w = getWidth();
    if (w <= 0) { invalidate(); return; }
    u = unit();
    stageL = (w - STAGE_W * u) / 2;
    float cL = stageL + PAD_X * u, cW = (STAGE_W - 2 * PAD_X) * u;

    // the bar: Cancel, the field (suggestions and paste, or the hint), Done
    float y0 = (BORDER + PAD_TOP) * u, y1 = y0 + BAR_H * u;
    cancelR.set(cL, y0, cL + textWidth("Cancel", BAR_FONT, sansMedium) + 2 * BAR_PAD * u, y1);
    doneR.set(cL + cW - textWidth(doneLabel, BAR_FONT, sansMedium) - 2 * BAR_PAD * u, y0, cL + cW, y1);
    fieldR.set(cancelR.right + BAR_SPACING * u, y0, doneR.left - BAR_SPACING * u, y1);
    float pasteW = textWidth("Paste", PASTE_FONT, sansMedium);
    pasteR.set(fieldR.right - FIELD_PAD * u - pasteW - 8 * u, y0, fieldR.right, y1);
    // Dictate sits left of Paste; its width is fixed for "Listening" so the bar doesn't jump when it changes
    float micW = textWidth("Listening", PASTE_FONT, sansMedium);
    micR.set(pasteR.left - 8 * u - micW - 8 * u, y0, pasteR.left, y1);
    float x = fieldR.left + FIELD_PAD * u;
    for (int i = 0; i < 3; i++) {
      if (i < suggestions.length && suggestions[i] != null) {
        float tw = textWidth(suggestions[i], SUG_FONT, i == 0 ? sansMedium : sans);
        sugR[i].set(x - 8 * u, y0, x + tw + 8 * u, y1);
        x += tw + 16 * u;
      } else {
        sugR[i].setEmpty();
      }
    }

    // the keys: each row centred, keys 86 wide (132 wide, 420 for the space bar), 8 apart
    if (emojiMode) { layoutEmoji(cL, cW); invalidate(); return; }
    String[][] rows = Layouts.rows(layout, email, url, multiLine);
    float top0 = keysTop();
    for (int r = 0; r < rows.length; r++) {
      String[] row = rows[r];
      float rowW = (row.length - 1) * KEY_GAP * u;
      for (String k : row) rowW += Layouts.width(k) * u;
      float kx = cL + (cW - rowW) / 2;
      float top = top0 + r * (KEY_H + KEY_GAP) * u;
      for (String k : row) {
        float kw = Layouts.width(k) * u;
        Key key = new Key(k);
        key.r.set(kx, top, kx + kw, top + KEY_H * u);
        keys.add(key);
        kx += kw + KEY_GAP * u;
      }
    }
    invalidate();
  }

  /**
   * The emoji panel's keys: a grid of 3 rows x 10 emoji (a page of Emoji.PER_PAGE), and the bottom row with ABC,
   * the nine category icons (Recent first) and the backspace. Same key height and gaps as the letters.
   */
  private void layoutEmoji(float cL, float cW) {
    String[] all = emojiCat == 0 ? ImeSettings.recentEmoji(getContext()) : Emoji.category(emojiCat);
    int pages = Math.max(1, (all.length + Emoji.PER_PAGE - 1) / Emoji.PER_PAGE);
    if (emojiPage >= pages) emojiPage = pages - 1;
    if (emojiPage < 0) emojiPage = 0;
    float top0 = keysTop();
    float gridW = (10 * Layouts.KEY_W + 9 * KEY_GAP) * u;
    float gx = cL + (cW - gridW) / 2;
    for (int r = 0; r < 3; r++) {
      for (int col = 0; col < 10; col++) {
        int i = emojiPage * Emoji.PER_PAGE + r * 10 + col;
        if (i >= all.length) continue;
        Key k = new Key(all[i]);
        k.glyph = all[i];
        place(k, gx + col * (Layouts.KEY_W + KEY_GAP) * u, top0 + r * (KEY_H + KEY_GAP) * u, Layouts.KEY_W);
      }
    }
    // the bottom row: ABC, the category icons, backspace (widths in CSS px, 8 apart, centred)
    final float catW = 74;
    int cats = Emoji.count();
    float rowW = Layouts.WIDE_W + cats * catW + Layouts.KEY_W + (cats + 2 - 1) * KEY_GAP;   // ABC, cats, DEL: cats + 2 items
    float x = cL + (cW - rowW * u) / 2;
    float rowTop = top0 + 3 * (KEY_H + KEY_GAP) * u;
    place(new Key(Layouts.TO_ALPHA), x, rowTop, Layouts.WIDE_W);
    x += (Layouts.WIDE_W + KEY_GAP) * u;
    for (int i = 0; i < cats; i++) {
      Key k = new Key("cat" + i);
      k.cat = i;
      k.glyph = Emoji.ICONS[i];
      place(k, x, rowTop, catW);
      x += (catW + KEY_GAP) * u;
    }
    place(new Key(Layouts.DEL), x, rowTop, Layouts.KEY_W);
  }

  /** Puts a key at x (device px), top (device px), of width w (CSS px), in the keys list. */
  private void place(Key k, float x, float top, float w) {
    k.r.set(x, top, x + w * u, top + KEY_H * u);
    keys.add(k);
  }

  // ---------- touch ----------

  @Override public boolean onTouchEvent(MotionEvent e) {
    switch (e.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
      case MotionEvent.ACTION_POINTER_DOWN: {
        int i = e.getActionIndex();
        down(e.getPointerId(i), e.getX(i), e.getY(i));
        break;
      }
      case MotionEvent.ACTION_MOVE:
        for (int i = 0; i < e.getPointerCount(); i++) move(e.getPointerId(i), e.getX(i), e.getY(i));
        break;
      case MotionEvent.ACTION_UP:
      case MotionEvent.ACTION_POINTER_UP: {
        int i = e.getActionIndex();
        up(e.getPointerId(i), true);
        break;
      }
      default:   // cancelled by the system: lift everything without typing
        for (Integer pid : new ArrayList<>(touches.keySet())) up(pid, false);
        break;
    }
    return true;
  }

  private static boolean hit(RectF r, float x, float y, float slop) {
    return !r.isEmpty() && x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop;
  }

  private void down(int pid, float x, float y) {
    Touch t = new Touch();
    t.lastX = x;
    t.startX = x;
    if (y < keysTop() - 6 * u) {   // the bar: Cancel, a suggestion, paste, Done (acted on lift, as a button is)
      if (hit(cancelR, x, y, 6 * u)) t.bar = BAR_CANCEL;
      else if (hit(doneR, x, y, 6 * u)) t.bar = BAR_DONE;
      else if (hit(pasteR, x, y, 0)) t.bar = BAR_PASTE;
      else if (dictationOn && hit(micR, x, y, 0)) t.bar = BAR_MIC;
      else for (int i = 0; i < 3; i++) if (hit(sugR[i], x, y, 0)) t.bar = i;
      if (t.bar == BAR_NONE) return;
      touches.put(pid, t);
      invalidate();
      return;
    }
    t.key = keyAt(x, y);
    if (t.key == null) return;
    touches.put(pid, t);
    haptic();
    String code = t.key.code;
    if (emojiMode) {   // the emoji panel: a category, an emoji (committed on lift), backspace, or back to the letters
      if (t.key.cat >= 0) { emojiCat = t.key.cat; emojiPage = 0; relayout(); }
      else if (t.key.glyph != null) t.pick = t.key.glyph;
      else if (Layouts.DEL.equals(code)) { if (listener != null) listener.onDelete(); scheduleDelete(t); }
      else if (Layouts.TO_ALPHA.equals(code)) { emojiMode = false; layout = base; relayout(); }
      invalidate();
      return;
    }
    if (Layouts.SPACE.equals(code)) {
      // the space is typed on lift, unless the finger swiped it into a cursor move
    } else if (Layouts.DEL.equals(code)) {
      if (listener != null) listener.onDelete();
      scheduleDelete(t);
    } else if (Layouts.SHIFT.equals(code)) {
      // one tap: the next letter is a capital; a second tap within a moment: capitals stay on; a tap then: off
      long now = SystemClock.uptimeMillis();
      if (caps) { caps = false; shift = false; }
      else if (shift && now - lastShiftAt < DOUBLE_TAP_MS) { caps = true; shift = false; }
      else if (autoShift && !shift) { autoShift = false; }   // at a sentence start, ⇧ makes the next letter lowercase
      else shift = !shift;
      lastShiftAt = now;
    } else if (Layouts.ENTER.equals(code)) {
      if (listener != null) listener.onEnter();
    } else if (Layouts.EMOJI.equals(code)) {
      emojiMode = true;
      emojiPage = 0;
      relayout();
    } else if (Layouts.TO_NUM.equals(code)) {
      layout = Layouts.SYM;
      relayout();
    } else if (Layouts.TO_ALPHA.equals(code)) {
      layout = base;
      relayout();
    } else {   // a letter, digit or symbol: typed as the key goes down, as on the web keyboard
      t.upper = shiftOn();
      typed(code);
      t.alts = code.length() == 1 ? Layouts.alternates(code) : null;
      if (t.alts != null) {
        t.task = () -> { if (!t.done && !t.cancelled) openPopup(t); };
        postDelayed(t.task, LONG_PRESS_MS);
      }
    }
    invalidate();
  }

  private void scheduleDelete(Touch t) {
    t.task = () -> {
      if (t.done || t.cancelled) return;
      if (listener != null) listener.onDelete();
      postDelayed(t.task, REPEAT_MS);
    };
    postDelayed(t.task, REPEAT_START_MS);
  }

  private void move(int pid, float x, float y) {
    Touch t = touches.get(pid);
    if (t == null || t.done || t.cancelled || t.key == null) return;
    if (t.popup) {
      int i = (int) Math.floor((x - t.popX0) / t.cellW);
      t.altIdx = Math.max(0, Math.min(t.alts.length() - 1, i));
      invalidate();
      return;
    }
    if (t.pick != null && !t.swiped && Math.abs(x - t.startX) >= PAGE_SWIPE_CSS * u) {
      // a sideways swipe on the emoji grid turns the page (the emoji it began on is not committed)
      t.swiped = true;
      t.pick = null;
      int np = emojiPage + (x < t.startX ? 1 : -1);
      String[] all = emojiCat == 0 ? ImeSettings.recentEmoji(getContext()) : Emoji.category(emojiCat);
      int pages = Math.max(1, (all.length + Emoji.PER_PAGE - 1) / Emoji.PER_PAGE);
      if (np >= 0 && np < pages) { emojiPage = np; relayout(); }
      invalidate();
      return;
    }
    if (Layouts.SPACE.equals(t.key.code)) {   // swipe the space bar to move the cursor
      float step = SWIPE_CSS * u;
      while (Math.abs(x - t.lastX) >= step) {
        int dir = x > t.lastX ? 1 : -1;
        t.lastX += dir * step;
        t.swiped = true;
        if (listener != null) listener.onCursor(dir);
      }
      return;
    }
    RectF r = t.key.r;
    float m = SLIP_CSS * u;
    // an emoji touch may slide sideways (that is the page swipe, above), so only sliding off it up or down cancels it
    boolean off = t.pick != null ? (y < r.top - m || y > r.bottom + m)
        : (x < r.left - m || x > r.right + m || y < r.top - m || y > r.bottom + m);
    if (off) {
      t.cancelled = true;   // slid off the key: a held key stops and a long press is dropped
      if (t.task != null) removeCallbacks(t.task);
      invalidate();
    }
  }

  private void up(int pid, boolean commit) {
    Touch t = touches.remove(pid);
    if (t == null) return;
    t.done = true;
    if (t.task != null) removeCallbacks(t.task);
    if (commit && listener != null) {
      if (t.bar != BAR_NONE) {
        if (t.bar == BAR_CANCEL) listener.onCancel();
        else if (t.bar == BAR_DONE) listener.onDone();
        else if (t.bar == BAR_PASTE) listener.onPaste();
        else if (t.bar == BAR_MIC) listener.onDictate();
        else listener.onSuggestion(t.bar);
      } else if (t.popup) {
        String alt = String.valueOf(t.alts.charAt(t.altIdx));
        boolean letter = Character.isLetter(alt.charAt(0));
        listener.onText(t.upper && letter ? alt.toUpperCase(Locale.ROOT) : alt);
      } else if (t.pick != null && !t.cancelled) {
        listener.onText(t.pick);   // an emoji: committed as text, like a letter (the keyboard learns nothing from it)
        if (learnRecent) {   // not in password fields (ClaudeKeyboard sets this from the field's type)
          ImeSettings.addRecentEmoji(getContext(), t.pick);
          if (emojiCat == 0) relayout();   // Recent has changed
        }
      } else if (t.key != null && Layouts.SPACE.equals(t.key.code) && !t.swiped) {
        listener.onSpace();
      }
    }
    invalidate();
  }

  /** The long press on a letter: the one typed as it went down is taken back, and the choices show. */
  private void openPopup(Touch t) {
    if (t.key == null || t.alts == null || listener == null) return;
    listener.onDelete();
    t.popup = true;
    t.altIdx = 0;
    haptic();
    float cell = Math.max(t.key.r.width(), 40 * u);
    float pw = t.alts.length() * cell + 12 * u;
    float left = Math.max(4 * u, Math.min(getWidth() - pw - 4 * u, t.key.r.centerX() - pw / 2));
    t.popLeft = left;
    t.popW = pw;
    t.popX0 = left + 6 * u;
    t.cellW = cell;
    t.popTop = Math.max(2 * u, t.key.r.top - (KEY_H + 6) * u);
    invalidate();
  }

  /** A letter, digit or symbol goes in, in the case shown; a one-shot shift is used up (keyboard.ts press()). */
  private void typed(String s) {
    if (listener == null) return;
    boolean letter = s.length() == 1 && Character.isLetter(s.charAt(0));
    String out = letter && shiftOn() ? s.toUpperCase(Locale.ROOT) : s;
    if (!caps) shift = false;   // a one-shot shift is used up; caps lock stays on
    listener.onText(out);
    invalidate();
  }

  /** A key press: the tap feedback, and the key click sound when Settings has it on (a system sound, not UI). */
  private void haptic() {
    performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
    if (ImeSettings.keySounds(getContext())) {
      AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
      if (am != null) am.playSoundEffect(AudioManager.FX_KEY_CLICK);
    }
  }

  private Key keyAt(float x, float y) {
    float slop = KEY_GAP / 2 * u;
    for (Key k : keys) {
      if (x >= k.r.left - slop && x <= k.r.right + slop && y >= k.r.top - slop && y <= k.r.bottom + slop) return k;
    }
    return null;
  }

  private boolean isPressed(Key k) {
    // keys are rebuilt by relayout() (after a suggestion or an edit), so the same key may be a new object: match its code and place
    for (Touch t : touches.values()) if (!t.cancelled && t.key != null && (t.key == k || (t.key.code.equals(k.code) && t.key.r.equals(k.r)))) return true;
    return false;
  }

  private boolean barPressed(int which) {
    for (Touch t : touches.values()) if (t.bar == which && !t.cancelled) return true;
    return false;
  }

  // ---------- drawing ----------

  @Override protected void onDraw(Canvas c) {
    c.drawColor(page);   // the page's own background, beside the keyboard when the stage is narrower than the screen
    float panelR = stageL + STAGE_W * u;
    fill.setStyle(Paint.Style.FILL);
    fill.setColor(rail);
    c.drawRect(stageL, 0, panelR, getHeight(), fill);
    fill.setColor(line);
    c.drawRect(stageL, 0, panelR, BORDER * u, fill);   // .kb border-top
    drawBar(c);
    for (Key k : keys) drawKey(c, k);
    for (Touch t : touches.values()) if (t.popup) drawPopup(c, t);
  }

  private void drawBar(Canvas c) {
    // Cancel: text only; pressed, it squeezes and takes the card-2 fill, as a key does
    float r = BAR_RADIUS * u;
    float cs = barPressed(BAR_CANCEL) ? PRESS_SCALE : 1f;
    if (cs < 1f) {
      fill.setColor(card2);
      c.drawRoundRect(squeezed(cancelR, cs), r, r, fill);
    }
    label(c, "Cancel", cancelR, sansMedium, BAR_FONT, t3, cs);

    // the field: a 1px line round a page-coloured box, as .kb-field
    fill.setColor(line);
    c.drawRoundRect(fieldR, r, r, fill);
    rect.set(fieldR.left + BORDER * u, fieldR.top + BORDER * u, fieldR.right - BORDER * u, fieldR.bottom - BORDER * u);
    fill.setColor(page);
    c.drawRoundRect(rect, r - BORDER * u, r - BORDER * u, fill);
    float midY = fieldR.centerY();
    boolean any = false;
    for (int i = 0; i < 3; i++) {
      if (sugR[i].isEmpty()) continue;
      any = true;
      if (barPressed(i)) pressedChip(c, sugR[i]);
      ink.setStyle(Paint.Style.FILL);
      ink.setTextAlign(Paint.Align.LEFT);
      ink.setTypeface(i == 0 ? sansMedium : sans);
      ink.setTextSize(SUG_FONT * u);
      ink.setColor(i == 0 ? text : t3);   // the best word in ink, the others quieter; clay stays for attention
      c.drawText(suggestions[i], sugR[i].left + 8 * u, baseline(ink, midY), ink);
    }
    if (!any && hint != null) {
      ink.setStyle(Paint.Style.FILL);
      ink.setTextAlign(Paint.Align.LEFT);
      ink.setTypeface(sans);
      ink.setTextSize(FIELD_FONT * u);
      ink.setColor(t5);
      c.drawText(hint, fieldR.left + FIELD_PAD * u, baseline(ink, midY), ink);
    }
    if (barPressed(BAR_PASTE)) pressedChip(c, pasteR);
    label(c, "Paste", pasteR, sansMedium, PASTE_FONT, t3, 1f);

    // Dictate: the voice key (VoiceService), in clay while it is listening
    if (dictationOn) {
      if (barPressed(BAR_MIC)) pressedChip(c, micR);
      label(c, dictating ? "Listening" : "Dictate", micR, sansMedium, PASTE_FONT, dictating ? clay : t3, 1f);
    }

    // Done: the inverted button, as .kb-done; pressed, the ink a touch lighter (light theme) or darker (dark theme)
    boolean donePressed = barPressed(BAR_DONE);
    float ds = donePressed ? PRESS_SCALE : 1f;
    fill.setColor(donePressed ? mix(text, page, .12f) : text);
    c.drawRoundRect(squeezed(doneR, ds), r, r, fill);
    label(c, doneLabel, doneR, sansMedium, BAR_FONT, page, ds);
  }

  private void pressedChip(Canvas c, RectF box) {
    rect.set(box.left + 4 * u, box.top + 4 * u, box.right - 4 * u, box.bottom - 4 * u);
    fill.setColor(card2);
    c.drawRoundRect(rect, 8 * u, 8 * u, fill);
  }

  /** A box scaled about its centre (the press squeeze), in the shared rect. */
  private RectF squeezed(RectF box, float s) {
    float cx = box.centerX(), cy = box.centerY(), hw = box.width() / 2 * s, hh = box.height() / 2 * s;
    rect.set(cx - hw, cy - hh, cx + hw, cy + hh);
    return rect;
  }

  /** Each channel of a and b, t of the way from a to b (opaque). */
  private static int mix(int a, int b, float t) {
    int out = 0xFF000000;
    for (int sh = 0; sh <= 16; sh += 8) {
      int ca = (a >> sh) & 0xFF, cb = (b >> sh) & 0xFF;
      out |= (Math.round(ca + (cb - ca) * t) & 0xFF) << sh;
    }
    return out;
  }

  /** Text centred in a box (the bar's labels), squeezed by m when pressed. */
  private void label(Canvas c, String s, RectF box, Typeface tf, float css, int color, float m) {
    ink.setStyle(Paint.Style.FILL);
    ink.setTextAlign(Paint.Align.CENTER);
    ink.setTypeface(tf);
    ink.setTextSize(css * u * m);
    ink.setColor(color);
    c.drawText(s, box.centerX(), baseline(ink, box.centerY()), ink);
  }

  private void drawKey(Canvas c, Key k) {
    String code = k.code;
    boolean pressed = isPressed(k);
    if (k.glyph != null) { drawGlyphKey(c, k, pressed); return; }
    boolean on = Layouts.SHIFT.equals(code) && (shift || caps);
    float s = pressed ? PRESS_SCALE : 1f;            // the press squeezes the key, ring and label together
    float cx = k.r.centerX(), cy = k.r.centerY();
    float hw = k.r.width() / 2 * s, hh = k.r.height() / 2 * s;
    // box-shadow: a 1px line round the key, and the 1px line under it
    rect.set(cx - hw - u, cy - hh - u, cx + hw + u, cy + hh + 2 * u);   // the extra 1px is the offset line under it
    fill.setColor(line);
    c.drawRoundRect(rect, (KEY_RADIUS + 1) * u, (KEY_RADIUS + 1) * u, fill);
    rect.set(cx - hw, cy - hh, cx + hw, cy + hh);
    fill.setColor(on ? text : pressed ? card2 : keyColor);
    c.drawRoundRect(rect, KEY_RADIUS * u, KEY_RADIUS * u, fill);
    drawLabel(c, code, cx, cy, s, on ? page : labelColor(code));
  }

  /**
   * An emoji panel key. A grid cell is the emoji itself on a plain tile (card2 while pressed); a category is a key like
   * the others, its icon in ink, card2 when it is the open category.
   */
  private void drawGlyphKey(Canvas c, Key k, boolean pressed) {
    float cx = k.r.centerX(), cy = k.r.centerY();
    if (k.cat < 0) {
      if (pressed) { fill.setColor(card2); c.drawRoundRect(k.r, KEY_RADIUS * u, KEY_RADIUS * u, fill); }
      drawText(c, k.glyph, cx, cy, 26, pressed ? PRESS_SCALE : 1f, sansMedium, text);
      return;
    }
    float s = pressed ? PRESS_SCALE : 1f;
    float hw = k.r.width() / 2 * s, hh = k.r.height() / 2 * s;
    rect.set(cx - hw - u, cy - hh - u, cx + hw + u, cy + hh + 2 * u);
    fill.setColor(line);
    c.drawRoundRect(rect, (KEY_RADIUS + 1) * u, (KEY_RADIUS + 1) * u, fill);
    rect.set(cx - hw, cy - hh, cx + hw, cy + hh);
    fill.setColor(k.cat == emojiCat || pressed ? card2 : keyColor);
    c.drawRoundRect(rect, KEY_RADIUS * u, KEY_RADIUS * u, fill);
    drawText(c, k.glyph, cx, cy, 20, s, sansMedium, text);
  }

  /** .wide keys (⇧ ⌫ 123 ABC, return) in the muted tone, the space bar in its own, the rest in the text colour. */
  private int labelColor(String code) {
    if (Layouts.SPACE.equals(code)) return t4;
    if (Layouts.ENTER.equals(code) && enterWord != null) return text;   // the field's action word, in ink
    if (Layouts.wide(code)) return t3;
    return text;
  }

  private void drawLabel(Canvas c, String code, float cx, float cy, float m, int color) {
    if (Layouts.SHIFT.equals(code)) { drawShift(c, cx, cy, 6 * u * m, color, shift || caps, caps); return; }
    if (Layouts.DEL.equals(code)) { drawBackspace(c, cx, cy, 6 * u * m, color); return; }
    if (Layouts.ENTER.equals(code)) {
      if (enterWord != null) drawText(c, enterWord, cx, cy, MULTI_FONT, m, sansMedium, color);
      else drawReturn(c, cx, cy, 6 * u * m, color);
      return;
    }
    // the space bar shows the layout's name, faint (t4)
    if (Layouts.SPACE.equals(code)) { drawText(c, "English", cx, cy, SMALL_FONT, m, sansMedium, color); return; }
    if (Layouts.TO_NUM.equals(code)) { drawText(c, "?123", cx, cy, SMALL_FONT, m, sansMedium, color); return; }
    if (Layouts.TO_ALPHA.equals(code)) { drawText(c, "ABC", cx, cy, SMALL_FONT, m, sansMedium, color); return; }
    if (Layouts.EMOJI.equals(code)) { drawText(c, Emoji.ICONS[1], cx, cy, 20, m, sansMedium, color); return; }
    if (code.length() > 1) { drawText(c, code, cx, cy, MULTI_FONT, m, sansMedium, color); return; }
    boolean letter = Character.isLetter(code.charAt(0));
    String shown = letter && shiftOn() ? code.toUpperCase(Locale.ROOT) : code;
    drawText(c, shown, cx, cy, KEY_FONT, m, sansMedium, color);
  }

  private void drawText(Canvas c, String s, float cx, float cy, float css, float m, Typeface tf, int color) {
    ink.setStyle(Paint.Style.FILL);
    ink.setTextAlign(Paint.Align.CENTER);
    ink.setTypeface(tf);
    ink.setTextSize(css * u * m);
    ink.setColor(color);
    c.drawText(s, cx, baseline(ink, cy), ink);
  }

  /** The ⇧ key: the arrow (filled when on); with caps lock, a bar under it. */
  private void drawShift(Canvas c, float cx, float cy, float s, int color, boolean on, boolean locked) {
    path.reset();
    path.moveTo(cx, cy - s);
    path.lineTo(cx + 0.8f * s, cy - 0.05f * s);
    path.lineTo(cx + 0.42f * s, cy - 0.05f * s);
    path.lineTo(cx + 0.42f * s, cy + 0.8f * s);
    path.lineTo(cx - 0.42f * s, cy + 0.8f * s);
    path.lineTo(cx - 0.42f * s, cy - 0.05f * s);
    path.lineTo(cx - 0.8f * s, cy - 0.05f * s);
    path.close();
    ink.setColor(color);
    ink.setStyle(on ? Paint.Style.FILL : Paint.Style.STROKE);
    ink.setStrokeJoin(Paint.Join.ROUND);
    ink.setStrokeWidth(1.5f * u);
    c.drawPath(path, ink);
    if (locked) {   // caps lock: the bar under the arrow
      ink.setStyle(Paint.Style.STROKE);
      ink.setStrokeWidth(1.5f * u);
      c.drawLine(cx - 0.6f * s, cy + 1.2f * s, cx + 0.6f * s, cy + 1.2f * s, ink);
    }
    ink.setStyle(Paint.Style.FILL);
  }

  private void drawBackspace(Canvas c, float cx, float cy, float s, int color) {
    ink.setColor(color);
    ink.setStyle(Paint.Style.STROKE);
    ink.setStrokeJoin(Paint.Join.ROUND);
    ink.setStrokeWidth(1.5f * u);
    path.reset();
    path.moveTo(cx - 0.95f * s, cy);
    path.lineTo(cx - 0.45f * s, cy - 0.75f * s);
    path.lineTo(cx + s, cy - 0.75f * s);
    path.lineTo(cx + s, cy + 0.75f * s);
    path.lineTo(cx - 0.45f * s, cy + 0.75f * s);
    path.close();
    c.drawPath(path, ink);
    float x0 = cx + 0.1f * s, x1 = cx + 0.7f * s;
    c.drawLine(x0, cy - 0.35f * s, x1, cy + 0.35f * s, ink);
    c.drawLine(x1, cy - 0.35f * s, x0, cy + 0.35f * s, ink);
    ink.setStyle(Paint.Style.FILL);
  }

  private void drawReturn(Canvas c, float cx, float cy, float s, int color) {
    ink.setColor(color);
    ink.setStyle(Paint.Style.STROKE);
    ink.setStrokeCap(Paint.Cap.ROUND);
    ink.setStrokeJoin(Paint.Join.ROUND);
    ink.setStrokeWidth(1.5f * u);
    path.reset();
    path.moveTo(cx + 0.9f * s, cy - 0.7f * s);
    path.lineTo(cx + 0.9f * s, cy + 0.2f * s);
    path.lineTo(cx - 0.8f * s, cy + 0.2f * s);
    path.moveTo(cx - 0.4f * s, cy - 0.2f * s);
    path.lineTo(cx - 0.8f * s, cy + 0.2f * s);
    path.lineTo(cx - 0.4f * s, cy + 0.6f * s);
    c.drawPath(path, ink);
    ink.setStyle(Paint.Style.FILL);
    ink.setStrokeCap(Paint.Cap.BUTT);
  }

  private void drawPopup(Canvas c, Touch t) {
    float rad = (KEY_RADIUS + 1) * u, cell = t.cellW, h = KEY_H * u;
    rect.set(t.popLeft, t.popTop, t.popLeft + t.popW, t.popTop + h);
    rect.inset(-u, -u);
    fill.setColor(line);
    c.drawRoundRect(rect, rad, rad, fill);
    rect.set(t.popLeft, t.popTop, t.popLeft + t.popW, t.popTop + h);
    fill.setColor(keyColor);
    c.drawRoundRect(rect, KEY_RADIUS * u, KEY_RADIUS * u, fill);
    for (int i = 0; i < t.alts.length(); i++) {
      float x0 = t.popX0 + i * cell;
      if (i == t.altIdx) {
        rect.set(x0 + 2 * u, t.popTop + 4 * u, x0 + cell - 2 * u, t.popTop + h - 4 * u);
        fill.setColor(text);   // the chosen one in ink, as the shift key is when on
        c.drawRoundRect(rect, (KEY_RADIUS - 2) * u, (KEY_RADIUS - 2) * u, fill);
      }
      char ch = t.alts.charAt(i);
      String shown = t.upper && Character.isLetter(ch) ? String.valueOf(ch).toUpperCase(Locale.ROOT) : String.valueOf(ch);
      drawText(c, shown, x0 + cell / 2, t.popTop + h / 2, KEY_FONT + 2, 1f, sansMedium, i == t.altIdx ? page : text);
    }
  }

  private static float baseline(Paint p, float cy) {
    Paint.FontMetrics fm = p.getFontMetrics();
    return cy - (fm.ascent + fm.descent) / 2f;
  }
}
