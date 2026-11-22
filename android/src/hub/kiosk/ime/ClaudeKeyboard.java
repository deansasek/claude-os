package hub.kiosk.ime;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.inputmethodservice.InputMethodService;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;

import hub.kiosk.MainActivity;
import hub.kiosk.VoiceService;

import java.util.List;
import java.util.Locale;

/**
 * Claude Keyboard: the tablet's keyboard in every app (Claude Home's Browser, Chrome, Gmail...).
 *
 * The field decides the layout (letters, number pad, phone pad; email and web-address keys), its capitals and
 * its Enter key (Go, Search, Send, Next, Done). Password fields get no suggestions and learn nothing; email and
 * web-address fields learn nothing either. Typed text is never logged.
 *
 * Threading: this service runs on the app's main thread, which also draws the page. An InputConnection read
 * (get*) is a synchronous call into the editor, which can wait on a busy WebView, so the keyboard keeps its own
 * state (the current word, sentence start, cursor) and reads the editor only when it has to: once when a field
 * takes focus, once after a cursor jump (debounced), and for a double space. Commits, deletes and key events are
 * not reads and are used freely.
 *
 * Voice: the Dictate key in the bar listens once (VoiceService.dictate) and types the words at the cursor. It is off
 * in password fields. The Claude page's voice flow is unchanged; a dictation takes the next request only.
 */
public class ClaudeKeyboard extends InputMethodService implements KeyboardView.Listener {
  private static final int MAX_PASTE = 4000;
  private static final long DOUBLE_SPACE_MS = 900, RESYNC_MS = 300;

  private KeyboardView kv;
  private EditorInfo info;
  private int base = Layouts.ALPHA;
  private boolean password, email, url, autoCap, wordsOn, learnable, multiLine, enterAction, noEnterAction;
  private int enterCode;
  private String enterLabel;
  private String[] shown = new String[0];
  private boolean lastWasSpace;
  private long lastSpaceAt;

  // local state, kept from what we typed (no editor reads per key)
  private final StringBuilder word = new StringBuilder();   // the letters typed since the last break
  private boolean autoShift;        // the next letter is a capital (start of a sentence)
  private boolean sentenceEnd;      // the last key typed was . ! or ?
  private boolean posKnown;         // ourPos is valid
  private int ourPos;               // the cursor as we last left it (to tell our own echo from a cursor jump)
  private int pendingEchoes;        // edits whose selection echo has not come back yet
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final Runnable resync = this::resyncCursor;

  @Override public View onCreateInputView() {
    kv = new KeyboardView(this);
    kv.setListener(this);
    return kv;
  }

  @Override public boolean onEvaluateFullscreenMode() { return false; }   // never the full-screen text box

  @Override public void onStartInputView(EditorInfo ei, boolean restarting) {
    super.onStartInputView(ei, restarting);
    if (kv == null) return;
    info = ei;
    classify();
    kv.setDark(isDark(this));
    kv.setDictationOn(!password);   // no voice into password fields
    kv.setLearnRecent(learnable);   // no emoji learned into Recent from password, email or web-address fields
    // a page that restarts input in the same field (after Send, say) keeps the emoji panel and caps lock as they were
    if (!restarting) kv.configure(base, email, url, multiLine);
    kv.setDone(enterAction ? enterLabel : null);   // the bar's Done shows the field's action (Go, Search...)
    kv.setHint(ei.hintText);
    if (!restarting) kv.resetShift();
    lastWasSpace = false;
    word.setLength(0);
    sentenceEnd = false;
    posKnown = false;
    pendingEchoes = 0;
    handler.removeCallbacks(resync);
    // the one editor read for a new field: is the cursor at the start of a sentence?
    InputConnection c = getCurrentInputConnection();
    autoShift = autoCap && c != null && c.getCursorCapsMode(info.inputType) != 0;
    afterEdit();
    MainActivity.refreshKeyboardPan();   // a field took focus: the page moves to keep it above the keyboard
  }

  /**
   * The cursor moved. Our own edits come back here too: they match the position we left, so nothing is done.
   * Any other move (a tap in the field, a change from the app) resets the word and resyncs once, debounced.
   */
  @Override public void onUpdateSelection(int oldSelStart, int oldSelEnd, int newSelStart, int newSelEnd,
                                          int candStart, int candEnd) {
    super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candStart, candEnd);
    if (kv == null || info == null) return;
    if (!posKnown) {   // first report for this field
      posKnown = true;
      ourPos = newSelStart;
      pendingEchoes = 0;
      return;
    }
    if (newSelStart == newSelEnd && newSelStart == ourPos) { pendingEchoes = 0; return; }   // our own edit
    if (pendingEchoes > 0 && newSelStart == newSelEnd) { pendingEchoes--; return; }        // an earlier one
    word.setLength(0);
    sentenceEnd = false;
    ourPos = newSelStart;
    pendingEchoes = 0;
    scheduleResync();
  }

  @Override public void onFinishInput() {
    super.onFinishInput();
    handler.removeCallbacks(resync);
    if (dictating) { dictating = false; dictationSession++; VoiceService.cancel(); }   // the field went away: drop the words
    if (kv != null) kv.setDictating(false);
    Words.get(this).save();
  }

  // ---------- dictation: the bar's Dictate key (VoiceService listens once; the words land in this field) ----------
  private boolean dictating;
  private int dictationSession;   // a dictation's callback only counts if it is still the current one

  @Override public void onDictate() {
    if (dictating) { dictationSession++; dictating = false; kv.setDictating(false); VoiceService.cancel(); return; }
    final int id = ++dictationSession;
    dictating = true;
    kv.setDictating(true);
    boolean ok = VoiceService.dictate(this, words -> onDictated(id, words));
    if (!ok) { dictating = false; kv.setDictating(false); kv.setHint("Voice isn't ready. Check the mic in ClaudeOS Settings."); }
  }

  /** The words from a dictation (or null when it ended without any). Typed at the cursor, like a word the user typed. */
  private void onDictated(int id, String words) {
    if (id != dictationSession) return;   // an old one, cancelled or replaced
    dictating = false;
    kv.setDictating(false);
    if (words == null || words.trim().isEmpty()) return;
    InputConnection c = getCurrentInputConnection();
    if (c == null) return;
    String s = words.trim();
    if (autoShift) s = Character.toUpperCase(s.charAt(0)) + s.substring(1);
    boolean endsSentence = s.endsWith(".") || s.endsWith("!") || s.endsWith("?");
    put(c, s + " ");
    word.setLength(0);
    lastWasSpace = true;
    sentenceEnd = endsSentence;
    autoShift = autoCap && endsSentence;
  }

  @Override public void onConfigurationChanged(Configuration newConfig) {
    super.onConfigurationChanged(newConfig);
    if (kv != null) kv.setDark(isDark(this));
  }

  /** Reads the field's type and Enter action. */
  private void classify() {
    int cls = info.inputType & InputType.TYPE_MASK_CLASS;
    int var = info.inputType & InputType.TYPE_MASK_VARIATION;
    int flags = info.inputType & InputType.TYPE_MASK_FLAGS;
    boolean text = cls == InputType.TYPE_CLASS_TEXT || cls == 0;
    password = (cls == InputType.TYPE_CLASS_TEXT && (var == InputType.TYPE_TEXT_VARIATION_PASSWORD
        || var == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD || var == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD))
        || (cls == InputType.TYPE_CLASS_NUMBER && var == InputType.TYPE_NUMBER_VARIATION_PASSWORD);
    email = cls == InputType.TYPE_CLASS_TEXT && (var == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        || var == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS);
    url = cls == InputType.TYPE_CLASS_TEXT && var == InputType.TYPE_TEXT_VARIATION_URI;
    boolean noSuggest = (flags & InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS) != 0;
    if (cls == InputType.TYPE_CLASS_NUMBER || cls == InputType.TYPE_CLASS_DATETIME) base = Layouts.NUM;
    else if (cls == InputType.TYPE_CLASS_PHONE) base = Layouts.PHONE;
    else base = Layouts.ALPHA;
    autoCap = text && !password && !email && !url;
    wordsOn = base == Layouts.ALPHA && text && !password && !email && !url && !noSuggest;
    learnable = wordsOn;
    multiLine = (flags & InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0;

    int action = info.imeOptions & EditorInfo.IME_MASK_ACTION;
    noEnterAction = (info.imeOptions & EditorInfo.IME_FLAG_NO_ENTER_ACTION) != 0;
    enterAction = !multiLine && !noEnterAction && action != EditorInfo.IME_ACTION_NONE
        && action != EditorInfo.IME_ACTION_UNSPECIFIED;
    enterCode = enterAction ? action : 0;
    enterLabel = enterAction ? actionLabel(action) : null;
  }

  private static String actionLabel(int action) {
    switch (action) {
      case EditorInfo.IME_ACTION_GO: return "Go";
      case EditorInfo.IME_ACTION_SEARCH: return "Search";
      case EditorInfo.IME_ACTION_SEND: return "Send";
      case EditorInfo.IME_ACTION_NEXT: return "Next";
      case EditorInfo.IME_ACTION_DONE: return "Done";
      default: return null;   // the return arrow
    }
  }

  // ---------- keys ----------

  @Override public void onText(String s) {
    InputConnection c = getCurrentInputConnection();
    if (c == null || s.isEmpty()) return;
    char first = s.charAt(0);
    boolean letter = Character.isLetter(first);
    if (!letter && first != '\'') wordBoundary(c);   // a digit or mark ends a word
    put(c, s);
    if (letter || first == '\'') word.append(s);
    sentenceEnd = s.equals(".") || s.equals("!") || s.equals("?");
    autoShift = false;   // a typed key ends the sentence start; a full stop waits for its space
    lastWasSpace = false;
    afterEdit();
  }

  @Override public void onDelete() {
    InputConnection c = getCurrentInputConnection();
    if (c == null) return;
    int n = 1;   // an emoji is two UTF-16 units: delete both, or a lone half is left behind
    if (word.length() == 0) {
      CharSequence before = c.getTextBeforeCursor(2, 0);
      if (before != null && before.length() == 2 && Character.isLowSurrogate(before.charAt(1))) n = 2;
    }
    cut(c, n);
    if (word.length() > 0) word.setLength(word.length() - 1);
    sentenceEnd = false;
    lastWasSpace = false;
    afterEdit();
  }

  /** The bar's Done: the field's action, then the keyboard closes. Never a new line. */
  @Override public void onDone() { performAction(); }

  /**
   * The field's action (Go, Search, Send, Next, Done), or the keyboard closes when there is none. Next keeps the
   * keyboard up, as the focus moves on. Shared by the bar's Done and the Enter key of a single-line field.
   */
  private void performAction() {
    InputConnection c = getCurrentInputConnection();
    lastWasSpace = false;
    if (c != null && enterAction) c.performEditorAction(enterCode);
    else if (!multiLine) sendDownUpKeyEvents(KeyEvent.KEYCODE_ENTER);   // no field action: the page gets a real Enter
    newLine();
    if (enterAction && enterCode == EditorInfo.IME_ACTION_NEXT) return;
    requestHideSelf(0);
  }

  /** The bar's Cancel: the keyboard closes; the text stays as it is. */
  @Override public void onCancel() {
    requestHideSelf(0);
  }

  @Override public void onSpace() {
    InputConnection c = getCurrentInputConnection();
    if (c == null) return;
    long now = SystemClock.uptimeMillis();
    if (wordsOn && lastWasSpace && now - lastSpaceAt < DOUBLE_SPACE_MS) {
      // two spaces after a word make a full stop and a space, as on the other keyboards.
      // The one editor read on this path: only on a double space, never on a single key.
      CharSequence before = c.getTextBeforeCursor(2, 0);
      if (before != null && before.length() == 2 && before.charAt(1) == ' ' && Character.isLetterOrDigit(before.charAt(0))) {
        cut(c, 1);
        put(c, ". ");
        word.setLength(0);
        lastWasSpace = false;
        autoShift = autoCap;
        sentenceEnd = false;
        afterEdit();
        return;
      }
    }
    wordBoundary(c);
    put(c, " ");
    if (sentenceEnd) autoShift = autoCap;   // after . ! or ? and a space: a capital
    sentenceEnd = false;
    lastWasSpace = true;
    lastSpaceAt = now;
    afterEdit();
  }

  /** The Enter key: a new line in a multi-line field; in a single-line field, the action (or the keyboard closes). */
  @Override public void onEnter() {
    if (!multiLine) { performAction(); return; }
    InputConnection c = getCurrentInputConnection();
    if (c == null) return;
    lastWasSpace = false;
    put(c, "\n");
    newLine();
  }

  /** After an Enter or the field's action: a new line starts a sentence (capital) when the field capitalises. */
  private void newLine() {
    word.setLength(0);
    sentenceEnd = false;
    autoShift = autoCap;
    afterEdit();
  }

  @Override public void onSuggestion(int index) {
    if (index < 0 || index >= shown.length) return;
    InputConnection c = getCurrentInputConnection();
    if (c == null) return;
    String pick = shown[index];
    cut(c, word.length());
    put(c, pick + " ");
    if (wordsOn) Words.get(this).learn(pick);
    word.setLength(0);
    sentenceEnd = false;
    autoShift = false;
    lastWasSpace = true;
    lastSpaceAt = SystemClock.uptimeMillis();
    afterEdit();
  }

  @Override public void onPaste() {
    InputConnection c = getCurrentInputConnection();
    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
    if (c == null || cm == null) return;
    ClipData clip = cm.getPrimaryClip();   // the clipboard, not the editor: a tap, not a key
    if (clip == null || clip.getItemCount() == 0) return;
    CharSequence cs = clip.getItemAt(0).coerceToText(this);
    if (cs == null || cs.length() == 0) return;
    String s = cs.length() > MAX_PASTE ? cs.subSequence(0, MAX_PASTE).toString() : cs.toString();
    put(c, s);
    word.setLength(0);
    sentenceEnd = false;
    autoShift = false;
    lastWasSpace = false;
    afterEdit();
  }

  @Override public void onCursor(int step) {
    sendDownUpKeyEvents(step > 0 ? KeyEvent.KEYCODE_DPAD_RIGHT : KeyEvent.KEYCODE_DPAD_LEFT);
    lastWasSpace = false;
    word.setLength(0);
    sentenceEnd = false;
    posKnown = false;   // the next report from the editor sets the position; the resync reads the capitals
    scheduleResync();
  }

  // ---------- helpers ----------

  /** Commits text; the keyboard keeps its own cursor position for it. */
  private void put(InputConnection c, String s) {
    c.commitText(s, 1);
    if (posKnown) ourPos += s.length();
    pendingEchoes++;
  }

  /** Deletes text before the cursor; the keyboard keeps its own cursor position for it. */
  private void cut(InputConnection c, int n) {
    if (n <= 0) return;
    c.deleteSurroundingText(n, 0);
    if (posKnown) ourPos = Math.max(0, ourPos - n);
    pendingEchoes++;
  }

  /** A word has ended (a space or a mark): fix a clear typo in it, learn it, and start a new word. */
  private void wordBoundary(InputConnection c) {
    if (!learnable) { word.setLength(0); return; }
    String w = word.toString();
    if (w.length() >= 2) {
      Words dict = Words.get(this);
      if (w.equals(w.toLowerCase(Locale.ROOT))) {
        String fix = dict.correction(w);
        if (fix != null) {
          cut(c, w.length());
          put(c, fix);
          w = fix;
        }
      }
      dict.learn(w);
    }
    word.setLength(0);
  }

  /** Once, debounced: after the cursor moved by something other than our own edits. */
  private void scheduleResync() {
    handler.removeCallbacks(resync);
    handler.postDelayed(resync, RESYNC_MS);
  }

  private void resyncCursor() {
    if (kv == null || info == null) return;
    InputConnection c = getCurrentInputConnection();
    autoShift = autoCap && c != null && c.getCursorCapsMode(info.inputType) != 0;
    afterEdit();
  }

  /** Local state only: the keyboard's capitals and suggestions. No editor reads. */
  private void afterEdit() {
    if (kv == null) return;
    kv.setAutoShift(autoShift);
    refreshSuggestions();
  }

  private void refreshSuggestions() {
    if (kv == null) return;
    String[] s = new String[0];
    if (wordsOn && word.length() > 0 && ImeSettings.suggestions(this)) {
      String w = word.toString();
      List<String> list = Words.get(this).suggest(w.toLowerCase(Locale.ROOT), 3);
      s = list.toArray(new String[0]);
      if (Character.isUpperCase(w.charAt(0))) {
        for (int i = 0; i < s.length; i++) s[i] = Character.toUpperCase(s[i].charAt(0)) + s[i].substring(1);
      }
    }
    shown = s;
    kv.setSuggestions(s);
  }

  /** Claude Home's own colour when it has sent one (its theme), else the system's night mode. */
  static boolean isDark(Context c) {
    Integer home = MainActivity.claudeHomeColor();
    if (home != null) return Color.luminance(home) < 0.5;
    return (c.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
  }
}
