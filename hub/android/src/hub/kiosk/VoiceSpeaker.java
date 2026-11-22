package hub.kiosk;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Claude Home's speaking voice: Android's TextToSpeech, on the media stream (so the media volume applies).
 *
 * Two kinds of voice:
 *  - on-device voices: the text never leaves the tablet. This is the default.
 *  - "natural" network voices (Google's engine, isNetworkConnectionRequired()): the text is sent to Google to
 *    be voiced. Only used when you pick one in Settings, or switch on "Prefer natural voices when online".
 *    With no connection (or if Google fails mid-sentence) it falls back to an on-device voice.
 */
final class VoiceSpeaker extends UtteranceProgressListener implements TextToSpeech.OnInitListener {
  private static VoiceSpeaker inst;
  private static volatile boolean speaking = false;

  private final Context app;
  private final TextToSpeech tts;
  private boolean ready = false;
  private Object[] pending;   // {text, id, test, voiceOverride} said before the engine was ready
  private AudioFocusRequest focus;
  // the last thing said, so a natural voice that fails can be retried on the tablet
  private String lastText, lastUid;
  private boolean lastNetwork, retrying;

  static synchronized VoiceSpeaker get(Context c) {
    if (inst == null) inst = new VoiceSpeaker(c.getApplicationContext());
    return inst;
  }
  static boolean speaking() { return speaking; }

  // ---------- what it said lately, so its own voice coming back through the mic isn't taken for you ----------
  private static final class Said { final String[] words; final long start; volatile long end; Said(String t) { words = words(t); start = System.currentTimeMillis(); } }
  private static final java.util.ArrayDeque<Said> said = new java.util.ArrayDeque<>();
  static volatile long lastEnd = 0;   // when it last stopped talking

  static String[] words(String t) {
    String s = t == null ? "" : t.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9' ]+", " ").trim();
    return s.isEmpty() ? new String[0] : s.split("\\s+");
  }

  /** Remember something being said now (also used by the silent test hook). */
  static void remember(String text) {
    synchronized (said) {
      said.addLast(new Said(text));
      while (said.size() > 8) said.removeFirst();
    }
  }
  static void rememberEnded() {
    long now = System.currentTimeMillis();
    synchronized (said) { Said s = said.peekLast(); if (s != null && s.end == 0) s.end = now; }
    lastEnd = now;
  }

  /** "…how can I help you today what's the weather" → "what's the weather": leading words that follow, in order,
   *  something it said in the last 5 s are its own echo and come off (2+ of them). */
  static String stripEchoPrefix(String heard) {
    String[] h = heard == null ? new String[0] : heard.trim().split("\\s+");
    if (h.length < 3) return heard == null ? "" : heard.trim();
    long now = System.currentTimeMillis();
    int best = 0;
    synchronized (said) {
      for (Said s : said) {
        if (s.end != 0 && now - s.end > 5000) continue;
        int j = 0, cut = 0;
        for (int i = 0; i < h.length; i++) {
          String w = h[i].toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9']", "");
          int found = -1;
          for (int k = j; k < s.words.length && k < j + 4; k++) if (s.words[k].equals(w)) { found = k; break; }
          if (found < 0) break;
          j = found + 1; cut = i + 1;
        }
        best = Math.max(best, cut);
      }
    }
    if (best < 2) return heard.trim();
    StringBuilder b = new StringBuilder();
    for (int i = best; i < h.length; i++) b.append(i > best ? " " : "").append(h[i]);
    return b.toString();
  }

  /**
   * Is this transcript just its own voice? Its words appear, mostly and in order, in something it said
   * recently: 60% while talking and for 1.5 s after; further back (up to 15 s) it takes 80% and 3+ words,
   * so you can still pick up a phrase from the answer ("what about tomorrow") on purpose.
   */
  static boolean isEcho(String heard) {
    String[] h = words(heard);
    if (h.length == 0) return false;
    long now = System.currentTimeMillis();
    synchronized (said) {
      for (Said s : said) {
        boolean fresh = s.end == 0 || now - s.end < 1500;
        if (!fresh && now - s.end > 15000) continue;
        int j = 0, match = 0;
        for (String w : h) {
          for (int k = j; k < s.words.length && k < j + 10; k++) if (s.words[k].equals(w)) { match++; j = k + 1; break; }
        }
        double ratio = (double) match / h.length;
        // (a single word only while it's still talking: "yes" right after "…say yes or no" is you)
        if (fresh && (h.length >= 2 ? ratio >= 0.6 : s.end == 0 && match == 1)) return true;
        if (!fresh && h.length >= 3 && ratio >= 0.8) return true;
      }
    }
    return false;
  }
  static void stopNow() { VoiceSpeaker s = inst; if (s != null) s.stop(); }

  private VoiceSpeaker(Context app) {
    this.app = app;
    tts = new TextToSpeech(app, this);
  }

  private SharedPreferences prefs() { return app.getSharedPreferences("hub", Context.MODE_PRIVATE); }

  @Override public void onInit(int status) {
    synchronized (this) {
      ready = status == TextToSpeech.SUCCESS;
      if (!ready) { VoiceService.emitError("tts_failed", "TextToSpeech init failed, status " + status); return; }
      tts.setOnUtteranceProgressListener(this);
      tts.setAudioAttributes(new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
      if (pending != null) { Object[] p = pending; pending = null; say((String) p[0], (String) p[1], (Boolean) p[2], (String) p[3]); }
    }
  }

  // ---------- which voice ----------
  static boolean network(Voice v) {
    return v != null && (v.isNetworkConnectionRequired() || v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NETWORK_SYNTHESIS));
  }
  private static boolean installed(Voice v) { return v != null && !v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED); }

  /** A working internet connection (validated by Android), so a natural voice can be used. */
  boolean online() {
    try {
      ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
      Network n = cm == null ? null : cm.getActiveNetwork();
      NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
      return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    } catch (Exception e) { return false; }
  }

  /** Best voice of one kind for a locale: same country first, then quality, then installed. */
  private Voice best(Locale want, boolean natural) {
    Set<Voice> all = tts.getVoices();
    if (all == null) return null;
    Voice best = null; int bestScore = -1;
    for (Voice v : all) {
      if (network(v) != natural || !v.getLocale().getLanguage().equals(want.getLanguage())) continue;
      if (!natural && !installed(v)) continue;   // never start a download on our own
      int score = v.getQuality() + (v.getLocale().getCountry().equals(want.getCountry()) ? 1000 : 0) + (installed(v) ? 100 : 0);
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  }

  /** The language voices are chosen in: the saved "voiceLang" tag, or the tablet's language when that is "". */
  private Locale wanted() {
    String tag = prefs().getString("voiceLang", "");
    if (tag != null && !tag.isEmpty()) {
      Locale l = Locale.forLanguageTag(tag);
      if (!l.getLanguage().isEmpty()) return l;
    }
    return Locale.getDefault();
  }

  /** The voice to speak with now. `override` (a voice id) is for Settings' samples; "" = the saved choice. */
  private Voice pickVoice(String override, boolean forceLocal) {
    Set<Voice> all = tts.getVoices();
    if (all == null) return null;
    String want = override != null && !override.isEmpty() ? override : prefs().getString("voiceName", "");
    boolean online = !forceLocal && online();
    if (!want.isEmpty()) {
      for (Voice v : all) {
        if (!v.getName().equals(want)) continue;
        if (!network(v) || online) return v;
        Voice twin = best(v.getLocale(), false);   // natural voice but no connection: same accent, on the tablet
        if (twin != null) return twin;
      }
    }
    Locale here = wanted();
    if (online && prefs().getBoolean("voiceNatural", false)) { Voice n = best(here, true); if (n != null) return n; }
    Voice def = tts.getDefaultVoice();
    if (def != null && !network(def) && installed(def)) return def;
    return best(here, false);
  }

  // ---------- speaking ----------
  synchronized void say(String text, String id, boolean test) { say(text, id, test, null); }

  /** Returns which kind of voice it used: "natural", "device", or null if nothing could speak. */
  synchronized String say(String text, String id, boolean test, String voiceOverride) {
    if (!ready) { pending = new Object[] { text, id, test, voiceOverride }; return "device"; }
    Voice v = pickVoice(voiceOverride, retrying);
    if (v == null) { VoiceService.emitError("no_voice", "No voice is installed on this tablet"); VoiceService.emit("spoken", "id", id, "stopped", true); return null; }
    tts.setVoice(v);
    tts.setSpeechRate((float) Math.max(0.5, Math.min(2.0, prefs().getFloat("voiceRate", 1.0f))));
    tts.setPitch((float) pitch());
    AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
    focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .build();
    am.requestAudioFocus(focus);
    String uid = (test ? "test:" : "") + id;
    lastText = text; lastUid = uid; lastNetwork = network(v);
    if (!test) { VoiceService.speakingText = text; remember(text); }   // so it can tell its own echo from you
    int max = TextToSpeech.getMaxSpeechInputLength();
    tts.speak(text.length() > max ? text.substring(0, max) : text, TextToSpeech.QUEUE_FLUSH, new Bundle(), uid);
    return lastNetwork ? "natural" : "device";
  }

  synchronized void stop() {
    if (ready) tts.stop();   // onStop follows if it was talking
  }

  private void finished(String uid, boolean stopped) {
    speaking = false;
    rememberEnded();
    AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
    if (focus != null) am.abandonAudioFocusRequest(focus);
    boolean test = uid != null && uid.startsWith("test:");
    if (!test) VoiceService.speakingChanged(false);
    VoiceService.emit("spoken", "id", test ? uid.substring(5) : uid, "stopped", stopped);
  }

  @Override public void onStart(String uid) {
    speaking = true;
    if (uid == null || !uid.startsWith("test:")) VoiceService.speakingChanged(true);
    VoiceService.emit("speaking", "id", uid, "natural", lastNetwork);
  }
  @Override public void onDone(String uid) { retrying = false; finished(uid, false); }
  @Override public void onStop(String uid, boolean interrupted) { retrying = false; finished(uid, true); }
  @Override @Deprecated public void onError(String uid) { onError(uid, TextToSpeech.ERROR); }
  @Override public void onError(String uid, int code) {
    Log.w(VoiceService.TAG, "tts error " + code);
    // a natural voice that couldn't reach Google: say it again on the tablet, once
    if (lastNetwork && !retrying && uid != null && uid.equals(lastUid)) {
      synchronized (this) {
        retrying = true;
        boolean test = uid.startsWith("test:");
        say(lastText, test ? uid.substring(5) : uid, test, null);
      }
      return;
    }
    retrying = false;
    finished(uid, true);
  }

  // ---------- for Settings ----------
  private static String accent(Locale l) {
    String c = l.getCountry(), lang = l.getLanguage();
    if ("en".equals(lang)) {
      switch (c) {
        case "US": return "US English"; case "GB": return "UK English"; case "AU": return "Australian English";
        case "IN": return "Indian English"; case "NG": return "Nigerian English"; case "CA": return "Canadian English";
        case "IE": return "Irish English"; case "ZA": return "South African English"; case "": return "English";
        default: break;
      }
    }
    String name = l.getDisplayLanguage(Locale.ENGLISH);
    return c.isEmpty() ? name : name + " (" + l.getDisplayCountry(Locale.ENGLISH) + ")";
  }

  synchronized String voicesJson() {
    try {
      JSONObject o = new JSONObject();
      o.put("ready", ready);
      o.put("voice", prefs().getString("voiceName", ""));
      o.put("rate", prefs().getFloat("voiceRate", 1.0f));
      o.put("natural", prefs().getBoolean("voiceNatural", false));
      o.put("online", online());
      o.put("lang", wanted().toLanguageTag());
      o.put("pitch", Math.round(pitch() * 100) / 100.0);
      JSONArray a = new JSONArray();
      if (ready && tts.getVoices() != null) {
        Voice cur = pickVoice(null, false);
        if (cur != null) { o.put("using", cur.getName()); o.put("usingNatural", network(cur)); }
        String lang = wanted().getLanguage();
        List<Voice> list = new ArrayList<>(tts.getVoices());
        // your language first, then English, then the rest; within a language by accent, natural first, then name
        list.sort((p, q) -> {
          int rp = p.getLocale().getLanguage().equals(lang) ? 0 : "en".equals(p.getLocale().getLanguage()) ? 1 : 2;
          int rq = q.getLocale().getLanguage().equals(lang) ? 0 : "en".equals(q.getLocale().getLanguage()) ? 1 : 2;
          if (rp != rq) return rp - rq;
          int c = p.getLocale().toLanguageTag().compareTo(q.getLocale().toLanguageTag());
          if (c != 0) return c;
          if (network(p) != network(q)) return network(p) ? -1 : 1;
          return p.getName().compareTo(q.getName());
        });
        Map<String, Integer> counts = new HashMap<>();
        for (Voice v : list) {
          boolean nat = network(v);
          String key = (nat ? "n" : "d") + v.getLocale().toLanguageTag();
          int n = counts.merge(key, 1, Integer::sum);
          JSONObject x = new JSONObject();
          x.put("id", v.getName());
          x.put("label", (nat ? "Natural" : "On-device") + " · " + accent(v.getLocale()) + " · Voice " + n);
          x.put("locale", v.getLocale().toLanguageTag());
          x.put("language", v.getLocale().getLanguage());
          x.put("network", nat);
          x.put("quality", v.getQuality());
          x.put("latency", v.getLatency());
          x.put("installed", installed(v));
          x.put("current", cur != null && cur.getName().equals(v.getName()));
          a.put(x);
        }
      }
      o.put("voices", a);
      return o.toString();
    } catch (Exception e) { return "{\"error\":" + JSONObject.quote(e.toString()) + "}"; }
  }

  void setOptions(String voice, double rate) {
    SharedPreferences.Editor e = prefs().edit();
    if (voice != null) e.putString("voiceName", voice);
    if (rate > 0) e.putFloat("voiceRate", (float) Math.max(0.5, Math.min(2.0, rate)));
    e.apply();
  }

  void setNatural(boolean on) { prefs().edit().putBoolean("voiceNatural", on).apply(); }

  /** Voice style: the pitch, 0.8 (calmer) to 1.2 (brighter); 1.0 is normal. */
  private double pitch() { return Math.max(0.8, Math.min(1.2, prefs().getFloat("voicePitch", 1.0f))); }

  void setPitch(double p) { if (p > 0) prefs().edit().putFloat("voicePitch", (float) Math.max(0.8, Math.min(1.2, p))).apply(); }

  /** Spoken language: a BCP-47 tag, "" = the tablet's language. A chosen voice of another language is dropped. */
  synchronized void setLanguage(String tag) {
    String t = tag == null ? "" : tag.trim();
    Locale nl = t.isEmpty() ? Locale.getDefault() : Locale.forLanguageTag(t);
    String lang = nl.getLanguage();
    SharedPreferences.Editor e = prefs().edit().putString("voiceLang", t);
    String cur = prefs().getString("voiceName", "");
    Set<Voice> all = ready ? tts.getVoices() : null;   // not loaded yet: keep the voice, nothing to compare
    if (!cur.isEmpty() && all != null) {
      String curLang = null;
      for (Voice v : all) if (v.getName().equals(cur)) { curLang = v.getLocale().getLanguage(); break; }
      if (curLang == null || !curLang.equals(lang)) e.putString("voiceName", "");
    }
    e.apply();
  }
}
