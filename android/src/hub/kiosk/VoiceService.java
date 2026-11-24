package hub.kiosk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.StorageService;

import java.io.FileInputStream;
import java.io.InputStream;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Voice for Claude Home: the "Hey Claude" wake word and speech-to-text, all on the tablet.
 *
 * How it works (see android/VOICE.md):
 * - A foreground service (type microphone) reads the mic at 16 kHz and feeds Vosk, an offline
 *   speech recogniser (Kaldi) with a small English model shipped inside the APK.
 * - Until the wake word fires, the only recogniser running is a GRAMMAR recogniser that knows two
 *   things: "hey claude" and "[unk]" (anything else). It cannot write down anything you say.
 *   Audio is never stored or sent anywhere; only the last few seconds sit in memory, so the words
 *   right after "Hey Claude" (said in one breath) aren't lost.
 * - After the wake word, a full recogniser transcribes until you stop talking, and the text (only
 *   the text) goes to the page, which sends it to Claude on the PC.
 * - While Claude Home is speaking, only "stop" / "hey claude" are listened for.
 * Nothing here uses the network.
 */
public class VoiceService extends Service {
  static final String TAG = "HubVoice";
  private static final int RATE = 16000;
  // The wake phrase as the small model actually hears a real voice across a desk: "claude" often comes
  // out as "cloud", "clod" or "clawed", and "hey" as "hi", "okay" or "a". Any greeting + any of those counts,
  // and so does "claude" alone at the very start of an utterance (i.e. after a pause).
  // Decoys: a grammar recogniser forces what it hears onto the phrases it knows, so give clear misses
  // ("hey Clyde", "close", "cold") somewhere else to land.
  // ("a claude" was tried too: with a TV or video talking in the room it woke on background chatter, so "a" is only a decoy)
  private static final java.util.Set<String> WAKE_GREET = new java.util.HashSet<>(java.util.Arrays.asList("hey", "hi", "okay"));
  private static final java.util.Set<String> WAKE_NAME = new java.util.HashSet<>(java.util.Arrays.asList("claude", "cloud", "clod", "clawed"));
  private static final String DECOYS = "\"hey\", \"hi\", \"okay\", \"a\", \"clyde\", \"claw\", \"close\", \"clue\", \"glide\", \"lord\", \"code\", \"called\", \"cold\", \"[unk]\"";
  private static final String WAKE_GRAMMAR = "[\"hey claude\", \"hi claude\", \"okay claude\", \"hey cloud\", \"hey clod\", \"hey clawed\", \"claude\", " + DECOYS + "]";

  // ---------- diagnostics: what the wake recogniser heard lately, and how loud the mic is ----------
  private static final java.util.ArrayDeque<String[]> heardLog = new java.util.ArrayDeque<>();   // {time, text, final|partial, woke}
  private static final float[] levelHist = new float[50];   // the last 5 s, 100 ms each, RMS 0..1
  private static int levelAt = 0;
  private static volatile String effects = "";

  private static void logHeard(String text, boolean fin, boolean woke) {
    synchronized (heardLog) {
      String[] last = heardLog.peekLast();
      if (last != null && last[1].equals(text) && !fin && "partial".equals(last[2])) return;   // partials repeat a lot
      heardLog.addLast(new String[] { String.valueOf(System.currentTimeMillis()), text, fin ? "final" : "partial", woke ? "1" : "" });
      while (heardLog.size() > 10) heardLog.removeFirst();
    }
  }

  /** For Settings: which recogniser writes down requests, and what the tablet offers. */
  static JSONObject sttJson() {
    JSONObject s = new JSONObject();
    try {
      Context c = self;
      s.put("onDevice", VoiceStt.onDeviceAvailable);
      s.put("onDeviceEnglish", VoiceStt.onDeviceEnglish);
      s.put("standard", VoiceStt.standardAvailable);
      s.put("cloud", c != null && VoiceStt.cloudAllowed(c));
      s.put("using", c == null ? "vosk" : String.valueOf(VoiceStt.choose(c)).replace("null", "vosk"));
      if (VoiceStt.lastError != null) s.put("lastError", VoiceStt.lastError);   // (not "error": the page reads that as a failed call)
      if (VoiceStt.lastCode != null) s.put("lastCode", VoiceStt.lastCode);
    } catch (Exception ignored) { }
    return s;
  }

  /** For Settings: {mode, rate, effects, level, peak, levels:[…], heard:[{at, text, final, woke}]} */
  static String diagJson() {
    try {
      JSONObject o = new JSONObject();
      o.put("mode", mode().name().toLowerCase());
      o.put("rate", RATE);
      o.put("effects", effects);
      o.put("floor", Math.round(Math.min(1, Math.sqrt(floorForDiag / 4000)) * 1000) / 1000.0);   // same scale as levels
      o.put("engine", engineInUse);
      o.put("stt", sttJson());
      JSONArray lv = new JSONArray();
      float peak = 0;
      synchronized (levelHist) {
        for (int i = 0; i < levelHist.length; i++) { float v = levelHist[(levelAt + i) % levelHist.length]; lv.put(Math.round(v * 1000) / 1000.0); peak = Math.max(peak, v); }
        o.put("level", Math.round(levelHist[(levelAt + levelHist.length - 1) % levelHist.length] * 1000) / 1000.0);
      }
      o.put("peak", Math.round(peak * 1000) / 1000.0);
      o.put("levels", lv);
      JSONArray h = new JSONArray();
      synchronized (heardLog) {
        for (String[] e : heardLog) {
          JSONObject x = new JSONObject();
          x.put("at", Long.parseLong(e[0])); x.put("text", e[1]); x.put("final", "final".equals(e[2])); x.put("woke", "1".equals(e[3]));
          h.put(x);
        }
      }
      o.put("heard", h);
      return o.toString();
    } catch (Exception e) { return "{\"error\":" + JSONObject.quote(e.toString()) + "}"; }
  }
  private static final int MAX_LISTEN_MS = 25000;
  private static final float END_SILENCE_S = 0.8f;   // a request is over after this much quiet
  private static final int NOTE_ID = 7;

  // ---------- talking to the page (MainActivity forwards these to window.hubVoice) ----------
  interface Sink { void event(String json); }
  static volatile Sink sink;
  private static final Handler main = new Handler(Looper.getMainLooper());
  private static final java.util.ArrayDeque<String> recent = new java.util.ArrayDeque<>();   // for the adb test hook only
  // Dry run (adb test hook): a WAV goes through the real wake → handover → transcription code with no events to
  // the page, no earcon and nothing brought to the front, so nothing on the tablet visibly or audibly happens.
  static volatile boolean dry = false;
  private static final java.util.ArrayList<String> dryLog = new java.util.ArrayList<>();

  static void emit(String type, Object... kv) {
    try {
      JSONObject o = new JSONObject();
      o.put("type", type);
      for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]);
      final String s = o.toString();
      if (dry) { synchronized (dryLog) { dryLog.add((System.currentTimeMillis() % 100000) + " " + s); } return; }   // a silent test: nothing reaches the page
      synchronized (recent) { recent.addLast((System.currentTimeMillis() % 100000) + " " + s); while (recent.size() > 40) recent.removeFirst(); }
      main.post(() -> { Sink k = sink; if (k != null) k.event(s); });
    } catch (Exception e) { Log.w(TAG, "emit", e); }
  }

  // ---------- state ----------
  enum Mode { LOADING, WAKE, LISTEN, SPEAKING, OFF }
  private static volatile VoiceService self;
  // The model and the warmed recognisers outlive one run while the wake word is off, so a tap does not reload them.
  // A run takes them back at its start and puts them here when it ends idle. forgetModel() (voice switched off in
  // Settings) or a failed run frees them; the app process ending frees them too.
  private static Model keptModel;
  private static Recognizer keptListen, keptSpeak;
  private static boolean dropKept = false;
  private static volatile Mode mode = Mode.OFF;
  private static volatile String lastError = null;   // the message, for the log
  // why voice failed, as a short code the page turns into a plain line (device.ts VoiceReason); null = no failure now
  private static volatile String lastCode = null;

  static Mode mode() { return self == null ? Mode.OFF : mode; }
  static String lastError() { return lastError; }
  static String lastCode() { return lastCode; }

  /** Record a failure: the code for the page, and the message for the log. */
  static void setError(String code, String message) { lastCode = code; lastError = message; Log.w(TAG, code + ": " + message); }
  /** setError, and tell the page (its 'error' event carries the code). */
  static void emitError(String code, String message) { setError(code, message); emit("error", "code", code, "message", message); }

  static SharedPreferences prefs(Context c) { return c.getSharedPreferences("hub", Context.MODE_PRIVATE); }
  static boolean wakeOn(Context c) { return prefs(c).getBoolean("voiceWake", false); }
  static boolean micAllowed(Context c) { return c.checkSelfPermission("android.permission.RECORD_AUDIO") == PackageManager.PERMISSION_GRANTED; }

  /** Start (or nudge) the service. listenMs > 0: listen right away, giving up after that much silence. On false, lastCode() says why. */
  static boolean start(Context c, int listenMs) {
    if (!micAllowed(c)) { setError("no_mic", "RECORD_AUDIO not granted"); return false; }
    Intent i = new Intent(c, VoiceService.class);
    if (listenMs > 0) i.putExtra("listen", listenMs);
    try { c.startForegroundService(i); return true; }
    catch (Exception e) { setError("unknown", "start: " + e); return false; }
  }
  static void stop(Context c) { c.stopService(new Intent(c, VoiceService.class)); }

  /** Voice is switched off in Settings: free the kept model now, or when the audio thread next ends. */
  static void forgetModel() {
    synchronized (VoiceService.class) {
      dropKept = true;
      if (keptListen != null) { keptListen.close(); keptListen = null; }
      if (keptSpeak != null) { keptSpeak.close(); keptSpeak = null; }
      if (keptModel != null) { keptModel.close(); keptModel = null; }
    }
  }

  /** Called on any thread; the audio thread runs it between buffers. */
  static void post(java.util.function.Consumer<VoiceService> job) {
    VoiceService s = self;
    if (s != null) s.jobs.add(() -> job.accept(s));
  }

  // ---------- the audio thread's world (only touched on that thread) ----------
  private final ConcurrentLinkedQueue<Runnable> jobs = new ConcurrentLinkedQueue<>();
  private volatile boolean running = false;
  private Thread thread;
  private Model model;
  private Recognizer wake, full, speak;
  // A fresh full recogniser is slow for its first second or two of speech on this tablet (the model builds its
  // search graph as it goes: ~3 s to get through 1 s of audio), so a request would show up seconds late and the
  // mic could overflow. Instead two live for as long as the service does, warmed once at start-up with a short
  // recorded phrase list, and are reset between uses: one for listening to you, one for barge-in while speaking.
  private Recognizer listenRec, speakRec;
  // The barge-in recogniser warms on its own thread after the mic opens (warmSpeakLater). That thread leaves its
  // recogniser in speakWarmed under warmLock; takeFull(true) takes it when speakRec is still missing.
  private final Object warmLock = new Object();
  private Recognizer speakWarmed;
  private Thread speakWarmThread;
  private volatile boolean warmAbort = false;   // set when the run ends, so a warm-up still running stops early

  // the recorded phrase, decoded once for both recognisers (empty if the asset can't be read)
  private short[] warmSamples;

  private short[] warmSamples() {
    if (warmSamples != null) return warmSamples;
    try (InputStream in = getAssets().open("voice-warmup.raw")) {
      byte[] b = in.readAllBytes();
      short[] s = new short[b.length / 2];
      for (int k = 0; k < s.length; k++) s[k] = (short) ((b[2 * k] & 0xff) | (b[2 * k + 1] << 8));
      warmSamples = s;
    } catch (Exception e) {
      Log.w(TAG, "warm-up", e);
      warmSamples = new short[0];
    }
    return warmSamples;
  }

  private void warm(Recognizer r) {
    short[] s = warmSamples();
    short[] c = new short[RATE / 10];   // one 100 ms buffer, reused for every chunk
    try {
      for (int at = 0; at < s.length && !warmAbort; at += RATE / 10) {
        int n = Math.min(RATE / 10, s.length - at);
        System.arraycopy(s, at, c, 0, n);
        r.acceptWaveForm(c, n);
      }
      r.getFinalResult();
    } catch (Exception e) { Log.w(TAG, "warm-up", e); }
    r.reset();
  }

  /** The long-lived recogniser for `which`, reset and ready. */
  private Recognizer takeFull() throws Exception {
    return takeFull(false);
  }
  private Recognizer takeFull(boolean forSpeaking) throws Exception {
    Recognizer r = forSpeaking ? speakRec : listenRec;
    if (r == null && forSpeaking) r = takeWarmed();
    if (r == null) r = new Recognizer(model, RATE);
    if (forSpeaking) speakRec = r; else listenRec = r;
    r.reset();
    return r;
  }

  private Recognizer takeWarmed() {
    synchronized (warmLock) { Recognizer r = speakWarmed; speakWarmed = null; return r; }
  }

  /** Warm the barge-in recogniser on its own thread, so the mic never waits for it. Its result waits in speakWarmed. */
  private void warmSpeakLater() {
    Model m = model;
    speakWarmThread = new Thread(() -> {
      Recognizer r = null;
      try { r = new Recognizer(m, RATE); warm(r); }
      catch (Exception e) { Log.w(TAG, "barge-in warm-up", e); }
      synchronized (warmLock) {
        if (r != null && !warmAbort) speakWarmed = r;   // (a run that already ended gets it closed here instead)
        else if (r != null) r.close();
      }
    }, "hub-voice-warm");
    speakWarmThread.start();
  }
  private long fed = 0;                        // samples given to `wake` since it was made
  private final short[] ring = new short[RATE * 8];
  private long ringTotal = 0;
  private int wakeHits = 0;
  private long listenStart, listenSilence;
  private boolean heard;
  private String lastPartial = "";
  private short[] inject;                      // test audio replacing the mic, see VOICE_TEST below
  private int injectPos;

  @Override public IBinder onBind(Intent i) { return null; }

  @Override public void onCreate() {
    super.onCreate();
    self = this;
    NotificationManager nm = getSystemService(NotificationManager.class);
    // Android requires this foreground notification while the microphone runs. Its channel is minimum importance:
    // no icon in the status bar, no sound, never heads-up. A channel's importance cannot be lowered after it exists,
    // so the channel is under a new id, and the older ones (louder, or at low importance) are removed.
    nm.deleteNotificationChannel("voice");
    nm.deleteNotificationChannel("voice-quiet");
    nm.createNotificationChannel(new NotificationChannel("voice-min", "Hey Claude", NotificationManager.IMPORTANCE_MIN));
    // adb-only test hook: the sender must hold DUMP, which only the shell (adb) does
    IntentFilter f = new IntentFilter("hub.kiosk.VOICE_TEST");
    registerReceiver(testReceiver, f, "android.permission.DUMP", null, Context.RECEIVER_EXPORTED);
    VoiceStt.probe(this);   // is Android's own recogniser here, and its English pack?
  }

  private Notification note() {
    PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
    return new Notification.Builder(this, "voice-min")
        .setSmallIcon(R.drawable.ic_hub)
        .setContentTitle("ClaudeOS")
        .setContentText(wakeOn(this) ? "Listening for “Hey Claude” on this tablet" : "Listening")
        .setContentIntent(open)
        .setOngoing(true)
        .build();
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    try { startForeground(NOTE_ID, note(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE); }
    catch (Exception e) { Log.w(TAG, "startForeground", e); emitError(micAllowed(this) ? "mic_busy" : "no_mic", "startForeground: " + e); stopSelf(); return START_NOT_STICKY; }
    final int listen = intent != null ? intent.getIntExtra("listen", 0) : 0;
    if (!running) {
      running = true;
      mode = Mode.LOADING;
      thread = new Thread(() -> run(listen), "hub-voice");
      thread.start();
    } else if (listen > 0) {
      jobs.add(() -> startListen(listen, false));
    } else {
      jobs.add(() -> { if (mode == Mode.WAKE || mode == Mode.OFF) idle(); });   // e.g. the wake word was just switched on
    }
    return START_STICKY;
  }

  @Override public void onDestroy() {
    running = false;
    try { unregisterReceiver(testReceiver); } catch (Exception ignored) { }
    if (thread != null) try { thread.join(1500); } catch (InterruptedException ignored) { }
    self = null;
    mode = Mode.OFF;
    emit("state", "mode", "off");
    super.onDestroy();
  }

  // ---------- the loop ----------
  private void run(int listenFirst) {
    AudioRecord rec = null;
    boolean failed = false;    // set when the run ends with an error: then nothing is kept for the next one
    String code = "unknown";   // the code for whatever stops this loop (VoiceService.emitError); set as each stage starts
    try {
      emit("state", "mode", "loading");
      LibVosk.setLogLevel(LogLevel.WARNINGS);
      code = "no_pack";
      synchronized (VoiceService.class) {   // take back what the last run kept, if anything
        model = keptModel; listenRec = keptListen; speakRec = keptSpeak;
        keptModel = null; keptListen = null; keptSpeak = null;
        dropKept = false;
        warmAbort = false;
      }
      if (model == null) {
        String path = StorageService.sync(this, "model-en-us", "model");   // unpacks from the APK once
        model = new Model(path);
      }
      code = micAllowed(this) ? "mic_busy" : "no_mic";
      int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE * 2 * 4));   // 4 s of slack, in bytes, so a slow moment never drops speech
      if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("microphone not available");
      code = "stt_failed";
      // a voice across a desk is quiet: let the tablet's own gain control and noise suppression help, where it has them
      StringBuilder fx = new StringBuilder("16 kHz mono");
      try {
        if (android.media.audiofx.AutomaticGainControl.isAvailable()) {
          android.media.audiofx.AutomaticGainControl agc = android.media.audiofx.AutomaticGainControl.create(rec.getAudioSessionId());
          if (agc != null) { agc.setEnabled(true); fx.append(agc.getEnabled() ? " · gain control" : ""); }
        }
        if (android.media.audiofx.AcousticEchoCanceler.isAvailable()) {   // subtract the tablet's own speaker, where it can
          android.media.audiofx.AcousticEchoCanceler aec = android.media.audiofx.AcousticEchoCanceler.create(rec.getAudioSessionId());
          if (aec != null) { aec.setEnabled(true); fx.append(aec.getEnabled() ? " · echo cancelling" : ""); }
        }
        if (android.media.audiofx.NoiseSuppressor.isAvailable()) {
          android.media.audiofx.NoiseSuppressor ns = android.media.audiofx.NoiseSuppressor.create(rec.getAudioSessionId());
          if (ns != null) { ns.setEnabled(true); fx.append(ns.getEnabled() ? " · noise suppression" : ""); }
        }
      } catch (Exception e) { Log.w(TAG, "audio effects", e); }
      effects = fx.toString();
      // warm the listen recogniser before the mic opens (once; a kept one is already warm). The barge-in recogniser
      // warms behind the mic, below, so the first request does not wait for it.
      long tw = System.currentTimeMillis();
      if (listenRec == null) { listenRec = new Recognizer(model, RATE); warm(listenRec); }
      Log.i(TAG, "listen recogniser ready in " + (System.currentTimeMillis() - tw) + " ms");
      rec.startRecording();
      if (speakRec == null) warmSpeakLater();
      lastError = null; lastCode = null;
      if (listenFirst > 0) startListen(listenFirst, false); else idle();
      short[] buf = new short[RATE / 10];   // 100 ms
      while (running) {
        Runnable job;
        while ((job = jobs.poll()) != null) job.run();
        if (mode == Mode.OFF) break;
        int n = rec.read(buf, 0, buf.length);
        if (n <= 0) { Thread.sleep(20); continue; }
        if (inject != null) {   // test audio stands in for the mic, at the mic's own pace; then the real (quiet) room
          for (int i = 0; i < n && injectPos < inject.length; i++) buf[i] = inject[injectPos++];
          if (injectPos >= inject.length) injectPos += n;   // (digital silence confuses end-of-speech detection; real room sound doesn't)
          if (injectPos >= inject.length + RATE * 4) {
            inject = null;
            if (dry) { VoiceSpeaker.rememberEnded(); idle(); dry = false; emit("state", "mode", mode == Mode.WAKE ? "wake" : "off"); }   // back to normal, quietly
          }
        }
        try { feed(buf, n); }
        catch (Exception e) {   // one bad buffer or result: note it, start listening for the wake word again, carry on
          Log.e(TAG, "voice", e);
          setError("stt_failed", String.valueOf(e.getMessage() != null ? e.getMessage() : e));   // recovers below: no event
          try { idle(); } catch (Exception ignored) { mode = Mode.OFF; }
        }
      }
    } catch (Throwable e) {
      Log.e(TAG, "voice loop", e);
      failed = true;
      emitError(code, String.valueOf(e.getMessage() != null ? e.getMessage() : e));
    } finally {
      if (rec != null) { try { rec.stop(); } catch (Exception ignored) { } rec.release(); }
      closeAll();
      running = false;
      warmAbort = true;   // a barge-in warm-up still running stops at its next buffer, then hands over or closes its result
      if (speakWarmThread != null) { try { speakWarmThread.join(); } catch (InterruptedException ignored) { } speakWarmThread = null; }
      Recognizer spare = takeWarmed();
      if (spare != null) { if (speakRec == null) speakRec = spare; else spare.close(); }
      synchronized (VoiceService.class) {
        if (model != null && !failed && !dropKept && !wakeOn(this)) {   // wake word off: keep the model for the next tap
          keptModel = model; keptListen = listenRec; keptSpeak = speakRec;
        } else {
          if (listenRec != null) listenRec.close();
          if (speakRec != null) speakRec.close();
          if (model != null) model.close();
        }
      }
      listenRec = null; speakRec = null; model = null;
      running = false;
      mode = Mode.OFF;
      main.post(this::stopSelf);
    }
  }

  private void closeAll() {
    if (wake != null) { wake.close(); wake = null; }
    full = null; speak = null;   // the long-lived ones are only set aside (reset on next use), never closed here
    if (stt != null) { stt.cancel(); stt = null; }
  }

  // ---------- the room's noise floor: a running estimate (falls fast, rises slowly) ----------
  private double noiseFloor = 150;
  static volatile boolean gateOn = true;      // (adb test hook can switch these to compare)
  static volatile double gateFactor = 1.2;   // offline A/B: 1.2 woke 10/10 in noise, 1.6 7/10, off 6/8
  private static volatile double floorForDiag = 0;
  private void trackFloor(double r) {
    noiseFloor = r < noiseFloor ? noiseFloor * 0.85 + r * 0.15 : noiseFloor * 0.997 + r * 0.003;
    noiseFloor = Math.max(30, noiseFloor);
    floorForDiag = noiseFloor;
  }

  private void remember(short[] buf, int n) {
    for (int i = 0; i < n; i++) ring[(int) ((ringTotal + i) % ring.length)] = buf[i];
    ringTotal += n;
  }

  private void feed(short[] buf, int n) throws Exception {
    remember(buf, n);
    double r = rms(buf, n);
    trackFloor(r);
    float lv = (float) Math.min(1, Math.sqrt(r / 4000));
    synchronized (levelHist) { levelHist[levelAt] = lv; levelAt = (levelAt + 1) % levelHist.length; }
    // a mode without its recogniser (shouldn't happen) must not take the whole voice thread down
    if ((mode == Mode.WAKE && wake == null) || (mode == Mode.LISTEN && full == null && stt == null) || (mode == Mode.SPEAKING && speak == null)) {
      Log.w(TAG, "no recogniser for " + mode + "; starting over");
      idle();
      return;
    }
    switch (mode) {
      case WAKE: feedWake(buf, n); break;
      case LISTEN: if (stt != null) feedStt(buf, n, r); else feedListen(buf, n); break;
      case SPEAKING: feedSpeaking(buf, n); break;
      default: break;
    }
  }

  // ---------- waiting for "Hey Claude" ----------
  /** Nothing to do: wait for the wake word, or (wake word off) let the microphone go. */
  private void idle() {
    closeAll();
    endDictation();   // any dictation still waiting ends here (its words, if any, were delivered first)
    if (!wakeOn(this) && !VoiceSpeaker.speaking()) { mode = Mode.OFF; emit("state", "mode", "off"); return; }
    if (VoiceSpeaker.speaking()) { mode = Mode.WAKE; toSpeaking(); return; }   // (not LISTEN any more, or toSpeaking would refuse)
    try {
      wake = new Recognizer(model, RATE, WAKE_GRAMMAR);
      wake.setWords(true);   // (no setPartialWords: with it, this model's grammar partials come back empty)
    } catch (Exception e) { Log.e(TAG, "wake recogniser", e); mode = Mode.OFF; return; }
    fed = 0; wakeHits = 0; uttStart = 0;
    mode = Mode.WAKE;
    lastError = null; lastCode = null;   // listening again: whatever went wrong before is over
    emit("state", "mode", "wake");
  }

  private long uttStart = 0;   // `fed` when the wake recogniser's current utterance began
  private boolean fromWake = false;   // the current listen began with the wake word (its transcript starts with it)

  /**
   * In recognised text: 2 = a greeting + a Claude-like name ("hey claude", "hey clod", "hi cloud"): fire on its first
   * appearance, because in a noisy room it may only show once; 1 = "claude" alone at the start (want it twice); 0 = none.
   */
  private static int wakeIn(String text) {
    String[] w = text.trim().split("\\s+");
    for (int i = 1; i < w.length; i++) {
      // "hey" + any Claude-like name fires at once; "hi/okay claude" must show twice ("I like the clouds" ≈ "hi claude")
      if (WAKE_GREET.contains(w[i - 1]) && WAKE_NAME.contains(w[i])) return "hey".equals(w[i - 1]) ? 2 : 1;
    }
    return w.length > 0 && "claude".equals(w[0]) ? 1 : 0;
  }

  private void feedWake(short[] buf, int n) throws Exception {
    // noise gate for the wake recogniser only: audio near the room's noise floor is turned well down, so the
    // grammar recogniser isn't forever forcing a fan or a TV into "hey …" (the ring buffer keeps the real audio)
    if (gateOn && rms(buf, n) < noiseFloor * gateFactor) {
      short[] quiet = new short[n];
      for (int i = 0; i < n; i++) quiet[i] = (short) (buf[i] / 4);
      buf = quiet;
    }
    boolean done = wake.acceptWaveForm(buf, n);
    fed += n;
    JSONObject r = new JSONObject(done ? wake.getResult() : wake.getPartialResult());
    String text = r.optString(done ? "text" : "partial");
    int strength = wakeIn(text);
    String said = text.replace("[unk]", "…").trim();
    if (!dry && !said.isEmpty() && !said.matches("[… ]+")) logHeard(said, done, strength > 0 && (done || strength >= 2 || wakeHits >= 1));
    if (dry && !said.isEmpty()) emit("dry-wake-" + (done ? "final" : "partial"), "text", said);
    if (strength == 0) { wakeHits = 0; if (done) uttStart = fed; return; }
    // fire on the very first partial with "hey claude" in it, while you're still talking, so "Hey Claude, what time
    // is it" works in one breath; a sound-alike has to show up twice in a row (partials flicker)
    if (!done && ++wakeHits < (strength >= 2 ? 1 : 2)) return;
    // hand over with no gap. Best: from just after the name, using the word times the wake recogniser gives when
    // asked to finish (so the request recogniser never hears "Hey Claude" and can't turn it into "a quad").
    // Otherwise: the whole utterance so far, and stripWake takes the wake words off the transcript.
    long after = Math.max(0, Math.min(Math.min(ring.length, RATE * 4L), fed - uttStart));
    long nameEnd = -1;
    try {
      JSONArray words = new JSONObject(wake.getFinalResult()).optJSONArray("result");
      if (words != null) for (int i = 0; i < words.length(); i++) {
        JSONObject wd = words.getJSONObject(i);
        if (WAKE_NAME.contains(wd.optString("word"))) nameEnd = Math.round(wd.optDouble("end", -1) * RATE);
      }
    } catch (Exception ignored) { }
    boolean cut = false;
    if (nameEnd > 0 && nameEnd <= fed && fed - nameEnd <= after) {
      after = Math.min(after, fed - nameEnd + RATE * 12L / 100);   // 0.12 s early: the word times run a touch late
      cut = true;
    }
    // how loud your "Hey Claude" was: the request is only "you talking" when it's about that loud,
    // so a TV or a radio in the room can't keep the request open or become one
    long wakeLen = Math.max(0, Math.min(Math.min(ring.length, RATE * 4L), fed - uttStart) - after);
    voiceLevel = 0;
    if (wakeLen > RATE / 5) {
      short[] w = new short[(int) wakeLen];
      for (int i = 0; i < wakeLen; i++) w[i] = ring[(int) ((ringTotal - after - wakeLen + i) % ring.length)];
      voiceLevel = loudPartRms(w);
    }
    if (dry) emit("dry-cut", "nameEnd", nameEnd, "fed", fed, "cut", cut);
    short[] carry = new short[(int) after];
    for (int i = 0; i < after; i++) carry[i] = ring[(int) ((ringTotal - after + i) % ring.length)];
    uttStart = fed;
    Log.i(TAG, "wake word (" + (done ? "final" : "partial") + "), carrying " + after * 1000 / RATE + " ms");
    emit("wake", "on", done ? "final" : "partial", "carryMs", after * 1000 / RATE);
    chime();          // played without pausing capture
    bringToFront();
    retriesLeft = 1;
    beginRequest(carry, 8000, true);
    // (still strip: the cut is only as good as the word times; stripWake leaves a clean request alone)
  }

  // ---------- the request: Android's recogniser when there is one (VoiceStt), else Vosk ----------
  private VoiceStt stt;
  private double voiceLevel = 0;   // RMS of the loud part of your "Hey Claude" (0 = unknown)
  private long lastLoudAt, sttEnded;

  /** RMS of the loudest half of 50 ms frames: a voice's level, ignoring the gaps between words. */
  private static double loudPartRms(short[] s) {
    int f = RATE / 20, nf = s.length / f;
    if (nf == 0) return rms(s, s.length);
    double[] e = new double[nf];
    for (int k = 0; k < nf; k++) { double a = 0; for (int i = k * f; i < (k + 1) * f; i++) a += (double) s[i] * s[i]; e[k] = a / f; }
    java.util.Arrays.sort(e);
    double sum = 0; int cnt = 0;
    for (int k = nf / 2; k < nf; k++) { sum += e[k]; cnt++; }
    return Math.sqrt(sum / Math.max(1, cnt));
  }

  /**
   * What the request recogniser hears: 50 ms frames much quieter than your own voice (a TV, people talking
   * further away, the fan) are turned right down, so it writes down you and not the room. Copies; the ring
   * buffer and the Vosk fallback keep the real audio.
   */
  private short[] gateForRequest(short[] buf, int n) {
    if (!gateOn) return buf;
    double keep = Math.max(noiseFloor * 1.8, voiceLevel * 0.3);
    short[] out = java.util.Arrays.copyOf(buf, n);
    int f = RATE / 20;
    for (int at = 0; at < n; at += f) {
      int end = Math.min(n, at + f);
      double a = 0;
      for (int i = at; i < end; i++) a += (double) out[i] * out[i];
      if (Math.sqrt(a / Math.max(1, end - at)) < keep) for (int i = at; i < end; i++) out[i] = (short) (out[i] * 0.12);
    }
    return out;
  }

  /** Loud enough to be you talking (not the room, not a TV). */
  private double speechThreshold() {
    return Math.max(Math.max(noiseFloor * 2.5, 250), voiceLevel * 0.45);
  }
  private boolean sttSpeech;
  private final java.util.ArrayList<short[]> sinceStart = new java.util.ArrayList<>();   // for falling back to Vosk mid-request
  private int retriesLeft = 1;
  static volatile String engineInUse = "vosk";

  /** Start writing down a request. carry: audio already said (e.g. right after "Hey Claude"). */
  private void beginRequest(short[] carry, int silenceMs, boolean afterWake) throws Exception {
    String kind = VoiceStt.choose(this);
    if (kind != null) {
      closeAll();
      VoiceStt s = new VoiceStt(this, kind, sttOut);
      if (s.start()) {
        stt = s;
        engineInUse = kind;
        listenStart = System.currentTimeMillis();
        listenSilence = silenceMs;
        fromWake = afterWake;
        heard = false; lastPartial = ""; sttSpeech = false; sttEnded = 0; lastLoudAt = 0;
        sinceStart.clear();
        mode = Mode.LISTEN;
        if (!afterWake) { chime(); quietUntil = System.currentTimeMillis() + 300; }   // its chime / last echo: ignored
        emit("state", "mode", "listening");
        if (carry != null && carry.length > 0) feedStt(carry, carry.length, rms(carry, carry.length));
        return;
      }
    }
    engineInUse = "vosk";
    startListen(silenceMs, afterWake);
    fromWake = afterWake;
    if (carry != null && carry.length > 0) feedListen(carry, carry.length);
  }

  /** Feed the Android recogniser, and decide when you've finished: speech, then 0.8 s near the noise floor. */
  private long quietUntil = 0;   // the first moments of a listen without the wake word are turned right down

  private static short[] hushed(short[] buf, int n) {
    short[] o = new short[n];
    for (int i = 0; i < n; i++) o[i] = (short) (buf[i] / 20);
    return o;
  }

  private void feedStt(short[] buf, int n, double r) {
    if (System.currentTimeMillis() < quietUntil) { stt.write(hushed(buf, n), n); return; }
    stt.write(gateForRequest(buf, n), n);
    if (sinceStart.size() < 300) sinceStart.add(java.util.Arrays.copyOf(buf, n));
    if (n <= RATE / 5) emit("level", "v", Math.round(Math.min(1, Math.sqrt(r / 4000)) * 100) / 100.0);
    long now = System.currentTimeMillis();
    if (r > speechThreshold()) { sttSpeech = true; lastLoudAt = now; }
    if (sttEnded == 0) {
      if (sttSpeech && now - lastLoudAt > 800) { stt.endInput(); sttEnded = now; }                 // you've stopped
      else if (now - listenStart > MAX_LISTEN_MS) { stt.endInput(); sttEnded = now; }               // talking too long
      else if (!sttSpeech && now - listenStart > listenSilence) { stt.endInput(); sttEnded = now; } // never started
    } else if (now - sttEnded > 6000) {   // it never answered: give up quietly
      emit("timeout"); idle();
    }
  }

  private final VoiceStt.Out sttOut = new VoiceStt.Out() {
    @Override public void partial(String t) { jobs.add(() -> { if (stt == null) return;
      String p = clean(fromWake ? stripWake(t.toLowerCase()) : t);
      if (VoiceSpeaker.isEcho(p)) return;   // its own voice: not shown, not counted
      if (!p.isEmpty() && !p.equals(lastPartial)) { heard = true; lastPartial = p; emit("partial", "text", p); } }); }
    @Override public void result(String t) { jobs.add(() -> {
      if (stt == null) return;
      stt = null;
      handleRequest(sttSpeech ? t : "");   // nothing as loud as you spoke: whatever it wrote down was the room
    }); }
    @Override public void failed(int code, boolean fallback) { jobs.add(() -> {
      if (stt == null) return;
      stt = null;
      emit("stt-failed", "code", code, "fallback", fallback);
      if (fallback) {   // the recogniser can't: Vosk writes this one down instead, from the start
        Log.w(TAG, "android recogniser failed (" + code + "), using Vosk");
        engineInUse = "vosk";
        boolean fw = fromWake;
        startListen((int) listenSilence, true);
        fromWake = fw;
        try { for (short[] b : sinceStart) feedListen(b, b.length); } catch (Exception e) { idle(); }
        return;
      }
      if (!heard && retriesLeft-- > 0 && fromWake) { restartForRequest(); return; }
      emit("timeout"); idle(); }); }
  };

  /** "Hey Claude" and nothing (or nothing usable) yet: keep listening for the request, once. */
  private void restartForRequest() {
    int keep = (int) Math.min(ringTotal, RATE * 35L / 100);   // 0.35 s, in case the request had just begun
    short[] tail = new short[keep];
    for (int i = 0; i < keep; i++) tail[i] = ring[(int) ((ringTotal - keep + i) % ring.length)];
    try { beginRequest(tail, 8000, true); fromWake = false; } catch (Exception e) { idle(); }
  }

  private static final java.util.Set<String> ONE_WORD_OK = new java.util.HashSet<>(java.util.Arrays.asList(
      "louder", "quieter", "brighter", "dimmer", "darker", "mute", "unmute", "stop", "cancel", "yes", "no", "yeah", "nope",
      "allow", "deny", "continue", "thanks", "weather", "time", "help", "approve", "okay", "ok", "sure"));

  /** What to do with a finished request: never send what's left of "Claude" ("a quad") or a stray word. */
  private void handleRequest(String raw) {
    String text = clean(raw == null ? "" : raw.trim());
    // its own voice coming back (a follow-up that only heard the end of the answer): nothing to send
    if (VoiceSpeaker.isEcho(text)) { emit("echo", "heard", text); text = ""; }
    else text = clean(VoiceSpeaker.stripEchoPrefix(text));   // the end of its answer, then you: keep you
    if (fromWake) text = clean(stripWake(text.toLowerCase()));
    // any request that starts with the wake phrase ("Hey Claude", said again into a follow-up) loses it too
    text = clean(text.replaceFirst("(?i)^(?:(?:hey|hi|okay|ok)\\s+)?(?:claude|cloud|clod|clawed)\\b[\\s,.!?]*", "").trim());
    String[] words = text.isEmpty() ? new String[0] : text.split("\\s+");
    boolean usable = words.length >= 2 || (words.length == 1 && ONE_WORD_OK.contains(words[0].toLowerCase().replaceAll("[^a-z]", "")));
    if (!usable) {
      if (retriesLeft-- > 0) { emit("retry", "heard", text); restartForRequest(); return; }   // "didn't catch that, go on"
      emit("timeout"); idle(); return;
    }
    // the keyboard's Dictate key: the words go to its field, not to the Claude page
    java.util.function.Consumer<String> into = dictation;
    if (into != null) {
      dictation = null;
      final String heard = text;
      main.post(() -> into.accept(heard));
      idle();
      return;
    }
    emit("final", "text", text);
    idle();
  }

  /** A short, soft two-note rise (like a little "mm-hm?") at the media volume: "I heard you". */
  private static short[] earcon;
  private void chime() {
    if (dry) return;
    try {
      if (earcon == null) {
        int sr = 22050, len = (int) (sr * 0.22);
        earcon = new short[len];
        for (int i = 0; i < len; i++) {
          double t = (double) i / sr, f = t < 0.09 ? 659.25 : 987.77;                  // E5 then B5
          double seg = t < 0.09 ? t : t - 0.09, segLen = t < 0.09 ? 0.09 : 0.13;
          double env = Math.min(1, seg / 0.008) * Math.exp(-seg * 3 / segLen);          // quick soft attack, gentle decay
          double s = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t);
          earcon[i] = (short) (s * env * 0.12 * Short.MAX_VALUE);   // quiet: a cue, and not loud enough to be taken for speech
        }
      }
      android.media.AudioTrack track = new android.media.AudioTrack.Builder()
          .setAudioAttributes(new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_MEDIA)
              .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
          .setAudioFormat(new AudioFormat.Builder().setSampleRate(22050).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
          .setTransferMode(android.media.AudioTrack.MODE_STATIC).setBufferSizeInBytes(earcon.length * 2).build();
      track.write(earcon, 0, earcon.length);
      track.play();
      main.postDelayed(track::release, 600);
    } catch (Exception e) { Log.w(TAG, "earcon", e); }
  }

  private void bringToFront() {
    if (dry || MainActivity.resumed) return;
    main.post(() -> {
      try { startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)); }
      catch (Exception e) { Log.w(TAG, "bring to front", e); }
    });
  }

  // ---------- writing down what you say ----------
  private void startListen(int silenceMs, boolean afterWake) {
    closeAll();
    try {
      full = takeFull();
      full.setEndpointerDelays(Math.max(2f, silenceMs / 1000f), END_SILENCE_S, MAX_LISTEN_MS / 1000f);
    } catch (Exception e) { Log.e(TAG, "recogniser", e); idle(); return; }
    listenStart = System.currentTimeMillis();
    listenSilence = silenceMs;
    fromWake = false;
    heard = false; lastPartial = "";
    mode = Mode.LISTEN;
    if (!afterWake) { chime(); quietUntil = System.currentTimeMillis() + 300; }
    emit("state", "mode", "listening");
  }

  /** Vosk's small model hears these in noise; on their own they mean nothing. */
  private static String clean(String s) {
    s = s == null ? "" : s.trim();
    return s.matches("(the|a|huh|uh|um|hmm|oh|and|i|it)") ? "" : s;
  }

  private long dryAcceptMs, dryPartialMs, dryChunks;

  private void feedListen(short[] buf, int n) throws Exception {
    long t0 = System.nanoTime();
    if (System.currentTimeMillis() < quietUntil) buf = hushed(buf, n);
    boolean done = full.acceptWaveForm(buf, n);
    long now = System.currentTimeMillis();
    if (dry) { dryAcceptMs += (System.nanoTime() - t0) / 1000000; dryChunks++; }
    // live level for the page's waveform: 0..1, roughly perceptual
    if (n <= RATE / 5) emit("level", "v", Math.round(Math.min(1, Math.sqrt(rms(buf, n) / 4000)) * 100) / 100.0);
    if (done) {
      String text = clean(new JSONObject(full.getResult()).optString("text"));
      if (!text.isEmpty()) { finishListen(text); return; }
    } else {
      long t1 = System.nanoTime();
      String p = clean(new JSONObject(full.getPartialResult()).optString("partial"));
      if (dry) dryPartialMs += (System.nanoTime() - t1) / 1000000;
      if (fromWake) p = clean(stripWake(p));   // show the request, not "hey claude"
      if (VoiceSpeaker.isEcho(p)) p = "";   // its own voice: not shown, not counted
      if (!p.isEmpty() && !p.equals(lastPartial)) { heard = true; lastPartial = p; emit("partial", "text", p); }
    }
    if (!heard && now - listenStart > listenSilence) { emit("timeout"); idle(); return; }
    if (now - listenStart > MAX_LISTEN_MS) {
      String text = clean(new JSONObject(full.getFinalResult()).optString("text"));
      if (text.isEmpty()) { emit("timeout"); idle(); } else finishListen(text);
    }
  }

  private static final java.util.regex.Pattern WAKE_AT = java.util.regex.Pattern.compile(
      "\\b(?:(?:hey|hi|okay|ok|a|hay|i)\\s+)?(?:claude|cloud|clod|clawed|claud|clyde|claw|clawd|clouds|clued|clue)\\b[\\s,.!?]*");
  // what's left of "Claude" when a recogniser mishears it: "a quad", "clot", "a clue"… (only at the very front)
  private static final java.util.regex.Pattern RESIDUE = java.util.regex.Pattern.compile(
      "^(?:(?:a|the|uh|um|hey|hi|okay|ok|and)\\s+)?(?:quad|quads|qu|q|cue|queue|cloud|clouds|clod|clawed|clyde|claud|claude|clot|clots|clue|clued|claw|claws|clawd|glad|lord|cod|clog|clogged|plod)\\b[\\s,.!?]*");

  /** The request alone: the wake phrase and any leftovers of "Claude" come off the front. */
  static String stripWake(String text) {
    String t = text.trim();
    // cut through the first wake phrase if it's within the first few words (anything before it is chatter)
    java.util.regex.Matcher m = WAKE_AT.matcher(t);
    if (m.find() && t.substring(0, m.start()).trim().split("\\s+").length <= 4) t = t.substring(m.end()).trim();
    // then up to two leading Claude-like fragments ("hey claude a quad what time is it" → "what time is it")
    for (int k = 0; k < 2; k++) {
      java.util.regex.Matcher r = RESIDUE.matcher(t);
      if (!r.find()) break;
      t = t.substring(r.end()).trim();
    }
    return t;
  }

  private void finishListen(String text) {
    Log.i(TAG, "heard " + text.length() + " chars");
    if (dry) { emit("dry-cost", "chunks", dryChunks, "acceptMs", dryAcceptMs, "partialMs", dryPartialMs); dryChunks = dryAcceptMs = dryPartialMs = 0; }
    handleRequest(text);
  }

  private void cancelListen() {
    if (mode == Mode.LISTEN) { emit("cancel"); idle(); }
  }

  // ---------- while Claude Home is speaking: barge-in ----------
  // A full recogniser keeps listening while it talks. Its own voice comes back through the mic, so a
  // result only counts as you when (a) its words mostly aren't in what it is saying, and (b) the mic is
  // clearly louder than its own echo has been so far. Then it stops talking and listens to you, keeping
  // the last moment of audio so your first words aren't lost. "stop" alone just stops it.
  static volatile String speakingText = "";
  private java.util.Set<String> echoWords = new java.util.HashSet<>();
  private double echoLevel = 0;
  private int speakBuffers = 0;

  private static java.util.List<String> words(String s) {
    java.util.List<String> out = new java.util.ArrayList<>();
    for (String w : s.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9' ]+", " ").trim().split("\\s+")) if (!w.isEmpty()) out.add(w);
    return out;
  }

  private void toSpeaking() {
    if (mode == Mode.LISTEN) return;   // don't cut you off
    closeAll();
    try { speak = takeFull(true); }
    catch (Exception e) { Log.e(TAG, "speak recogniser", e); mode = Mode.LOADING; return; }   // deaf until it stops talking
    echoWords = new java.util.HashSet<>(words(speakingText));
    echoLevel = 0; speakBuffers = 0;
    java.util.Arrays.fill(recentLevels, 0);
    mode = Mode.SPEAKING;
  }

  private static final java.util.Set<String> FILLER = new java.util.HashSet<>(java.util.Arrays.asList("the", "a", "an", "and", "i", "it", "uh", "um", "huh", "oh", "of", "to"));

  private final double[] recentLevels = new double[12];   // ~1.2 s of buffer loudness
  private int recentAt = 0;

  private void feedSpeaking(short[] buf, int n) throws Exception {
    double now = rms(buf, n);
    recentLevels[recentAt++ % recentLevels.length] = now;
    double lvl = 0;   // judge the words by how loud they were, not by the pause after them
    for (double x : recentLevels) lvl = Math.max(lvl, x);
    boolean done = speak.acceptWaveForm(buf, n);
    String text = new JSONObject(done ? speak.getResult() : speak.getPartialResult()).optString(done ? "text" : "partial");
    java.util.List<String> heardWords = words(text);
    // its own echo: a slow running average of the level while nothing new is being said
    if (heardWords.isEmpty() || speakBuffers < 5) echoLevel = speakBuffers++ == 0 ? now : echoLevel * 0.9 + now * 0.1;
    if (heardWords.isEmpty()) return;
    if (heardWords.contains("stop") && !echoWords.contains("stop") && heardWords.size() <= 3) { VoiceSpeaker.stopNow(); emit("stop"); return; }
    int novel = 0, real = 0;
    // judge only the latest words: a long echo utterance would otherwise drown out what you just said
    for (String w : heardWords.subList(Math.max(0, heardWords.size() - 6), heardWords.size())) { if (FILLER.contains(w)) continue; real++; if (!echoWords.contains(w)) novel++; }
    boolean you = novel >= 2 && novel >= 0.6 * real && lvl > echoLevel * 1.6 + 120 && !VoiceSpeaker.isEcho(text);    if (!you) { if (done) speak.reset(); return; }
    VoiceSpeaker.stopNow();
    emit("bargein");
    int keep = Math.min(ring.length, (int) (RATE * 1.6));   // the start of what you said
    short[] carry = new short[keep];
    for (int i = 0; i < keep; i++) carry[i] = ring[(int) ((ringTotal - keep + i) % ring.length)];
    startListen(6000, true);
    feedListen(carry, carry.length);
  }

  /** Loudness of a buffer (RMS of 16-bit samples). */
  private static double rms(short[] buf, int n) {
    double s = 0;
    for (int i = 0; i < n; i++) s += (double) buf[i] * buf[i];
    return n > 0 ? Math.sqrt(s / n) : 0;
  }

  /** VoiceSpeaker tells us when it starts and stops talking. */
  static void speakingChanged(boolean on) {
    post(s -> {
      if (s.model == null) return;
      if (on) s.toSpeaking();
      else if (s.mode == Mode.SPEAKING || s.mode == Mode.LOADING) s.idle();
    });
  }

  /** Listen without the wake word (follow-ups, tap to talk), with the better recogniser when there is one. */
  static void listen(int silenceMs) {
    // after it has spoken: wait until its voice has fully died away (600 ms after it finished), so the
    // follow-up never starts on the tail of its own answer
    long wait = VoiceSpeaker.speaking() ? 900 : Math.max(0, 600 - (System.currentTimeMillis() - VoiceSpeaker.lastEnd));
    if (wait > 0) { main.postDelayed(() -> listen(silenceMs), wait); return; }
    post(s -> {
      if (s.model == null) return;
      s.retriesLeft = 0;   // the page handles "didn't catch that" here
      try { s.beginRequest(null, silenceMs, false); } catch (Exception e) { s.idle(); }
    });
  }
  public static void cancel() { post(VoiceService::cancelListen); }

  // ---------- dictation (the keyboard's Dictate key) ----------
  // The next finished request goes to the keyboard's field instead of the Claude page. The callback gets the words,
  // or null when the request ended with none (silence, a cancel, the mic going away). Called on the UI thread.
  private static final int DICTATE_SILENCE_MS = 4000;
  private static volatile java.util.function.Consumer<String> dictation;
  /** Listen once for the keyboard. False: the mic or the voice service can't take it right now (nothing is set). */
  public static boolean dictate(Context c, java.util.function.Consumer<String> into) {
    Mode m = mode;
    if (!micAllowed(c) || m == Mode.LISTEN || m == Mode.SPEAKING || m == Mode.LOADING) return false;
    dictation = into;
    if (m == Mode.OFF) {   // not running yet: starting it listens right away (as voiceListen does)
      boolean ok = start(c, DICTATE_SILENCE_MS);
      if (!ok) dictation = null;
      return ok;
    }
    post(s -> {
      if (s.model == null || s.mode == Mode.LISTEN || s.mode == Mode.SPEAKING || s.mode == Mode.LOADING) { s.endDictation(); return; }
      s.retriesLeft = 0;   // no "didn't catch that" for a keyboard: silence just ends it
      try { s.beginRequest(null, DICTATE_SILENCE_MS, false); } catch (Exception e) { s.idle(); }
    });
    return true;
  }
  /** The dictation ended without words: the keyboard hears null, once. */
  private void endDictation() {
    java.util.function.Consumer<String> into = dictation;
    dictation = null;
    if (into != null) main.post(() -> into.accept(null));
  }

  // ---------- adb test hook ----------
  // Silent (preferred): nothing reaches the page, no earcon, no Claude session; only the result is kept.
  //   adb shell am broadcast -a hub.kiosk.VOICE_TEST --es dry /sdcard/Android/data/hub.kiosk/files/test.wav
  //   adb shell am broadcast -a hub.kiosk.VOICE_TEST --ez drylog true        (what it would have told the page)
  // Live (only with the user's OK — it acts like real speech: earcon, indicator, maybe a Claude session):
  //   adb shell am broadcast -a hub.kiosk.VOICE_TEST --es wav /sdcard/Android/data/hub.kiosk/files/test.wav
  //   adb shell am broadcast -a hub.kiosk.VOICE_TEST --ez events true        (events sent to the page lately)
  // WAVs: 16 kHz mono 16-bit, fed in place of the microphone.
  private final BroadcastReceiver testReceiver = new BroadcastReceiver() {
    @Override public void onReceive(Context c, Intent i) {
      String dryWav = i.getStringExtra("dry");
      if (i.hasExtra("gate")) gateOn = i.getBooleanExtra("gate", true);                 // --ez gate false
      if (i.hasExtra("gatefactor")) gateFactor = i.getFloatExtra("gatefactor", 1.6f);   // --ef gatefactor 1.2
      if (i.hasExtra("drylog")) {
        synchronized (dryLog) { setResultData(String.join("\n", dryLog)); }
        return;
      }
      // echo tests (silent): --es drysaid "<what it 'said'>" plus
      //   --es drylisten <wav>  : it has just finished saying that; a follow-up listen runs over the WAV
      //   --es drybarge <wav>   : it is saying that right now; the WAV is what the mic hears meanwhile
      final String drySaid = i.getStringExtra("drysaid");
      final String dryListen = i.getStringExtra("drylisten"), dryBarge = i.getStringExtra("drybarge");
      if (dryListen != null || dryBarge != null) dryWav = dryListen != null ? dryListen : dryBarge;
      final boolean isDry = dryWav != null;
      final String path = isDry ? dryWav : i.getStringExtra("wav");
      if (path != null) {
        new Thread(() -> {
          try (InputStream in = new FileInputStream(path)) {
            byte[] all = in.readAllBytes();
            int off = 44;   // PCM WAV: samples start after the "data" chunk header
            for (int k = 12; k + 8 <= all.length && k < 512; k++) {
              if (all[k] == 'd' && all[k + 1] == 'a' && all[k + 2] == 't' && all[k + 3] == 'a') { off = k + 8; break; }
            }
            short[] s = new short[(all.length - off) / 2];
            for (int k = 0; k < s.length; k++) s[k] = (short) ((all[off + 2 * k] & 0xff) | (all[off + 2 * k + 1] << 8));
            jobs.add(() -> {
              if (isDry) {
                if (mode == Mode.SPEAKING || VoiceSpeaker.speaking()) return;   // never while it's talking
                synchronized (dryLog) { dryLog.clear(); }
                dry = true;
                idle();   // start from "waiting for the wake word", like real speech would
                if (drySaid != null && dryBarge != null) {   // "speaking" that text now
                  VoiceSpeaker.remember(drySaid); speakingText = drySaid; toSpeaking();
                } else if (drySaid != null) {                 // just finished saying it
                  VoiceSpeaker.remember(drySaid); VoiceSpeaker.rememberEnded();
                }
              }
              inject = s; injectPos = 0;
              if (isDry && dryListen != null) { retriesLeft = 0; listen(7000); }   // the page's follow-up, as after a reply
            });
            Log.i(TAG, "test: injecting " + s.length * 1000L / RATE + " ms" + (isDry ? " (dry)" : ""));
          } catch (Exception e) { Log.w(TAG, "test wav", e); }
        }).start();
      }
      if (i.hasExtra("events")) {   // --ez events true: print (and clear) what was sent to the page lately
        synchronized (recent) { setResultData(String.join("\n", recent)); recent.clear(); }
      }
    }
  };
}
