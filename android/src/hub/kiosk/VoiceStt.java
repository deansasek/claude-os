package hub.kiosk;

import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * Writing down your request with Android's own speech recogniser, which is far better than the small Vosk
 * model, while Vosk keeps doing the wake word.
 *
 * The recogniser is fed OUR audio (RecognizerIntent.EXTRA_AUDIO_SOURCE, Android 13+) through a pipe, so the
 * words you said right after "Hey Claude" (already in VoiceService's ring buffer) go in first and nothing is
 * lost at the hand-over; the microphone itself is never handed to anyone else.
 *
 *  - "device": SpeechRecognizer.createOnDeviceSpeechRecognizer: audio never leaves the tablet. Needs the
 *    offline English pack (Settings → Voice offers the download).
 *  - "cloud":  the standard recogniser (Google): what you say after "Hey Claude" is sent to Google. Only when
 *    you switch on "Use Google speech recognition" in Settings (off by default).
 *  - neither:  VoiceService uses Vosk for the request too.
 */
final class VoiceStt {
  interface Out {
    void partial(String text);
    void result(String text);
    /** No speech / nothing recognised (fallback=false), or the recogniser can't do it (fallback=true). */
    void failed(int code, boolean fallback);
  }

  private static final Handler main = new Handler(Looper.getMainLooper());
  static volatile boolean onDeviceAvailable = false, standardAvailable = false;
  static volatile String onDeviceEnglish = "unknown";   // installed | downloadable | pending | missing | unknown
  static volatile String lastError = null;
  static volatile String lastCode = null;   // network | stt_failed (device.ts VoiceReason), for Settings' diagnostics

  static boolean cloudAllowed(Context c) { return VoiceService.prefs(c).getBoolean("voiceCloudStt", false); }

  /** Which recogniser to use now: "device", "cloud" or null (= Vosk). */
  static String choose(Context c) {
    if (Build.VERSION.SDK_INT < 33) return null;   // can't feed it our own audio before Android 13
    if (onDeviceAvailable && !"missing".equals(onDeviceEnglish) && !"downloadable".equals(onDeviceEnglish)) return "device";
    if (standardAvailable && cloudAllowed(c)) return "cloud";
    return null;
  }

  private static Intent intent(String kind) {
    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
    i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
    i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
    if ("cloud".equals(kind)) i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
    return i;
  }

  /** Main thread: what this tablet offers, and whether the on-device English pack is there. */
  static void probe(Context c) {
    main.post(() -> {
      try {
        standardAvailable = SpeechRecognizer.isRecognitionAvailable(c);
        onDeviceAvailable = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(c);
        if (!onDeviceAvailable || Build.VERSION.SDK_INT < 33) return;
        SpeechRecognizer sr = SpeechRecognizer.createOnDeviceSpeechRecognizer(c);
        sr.checkRecognitionSupport(intent("device"), Runnable::run, new RecognitionSupportCallback() {
          @Override public void onSupportResult(RecognitionSupport s) {
            onDeviceEnglish = has(s.getInstalledOnDeviceLanguages()) ? "installed"
                : has(s.getPendingOnDeviceLanguages()) ? "pending"
                : has(s.getSupportedOnDeviceLanguages()) ? "downloadable" : "missing";
            main.post(sr::destroy);
          }
          @Override public void onError(int error) { onDeviceEnglish = "unknown"; main.post(sr::destroy); }
        });
      } catch (Exception e) { Log.w(VoiceService.TAG, "stt probe", e); lastError = e.toString(); }
    });
  }
  private static boolean has(List<String> langs) {
    if (langs == null) return false;
    for (String l : langs) if (l != null && l.toLowerCase().startsWith("en")) return true;
    return false;
  }

  /** Ask Android to download the on-device English pack (it shows its own progress). */
  static void download(Context c) {
    if (Build.VERSION.SDK_INT < 33) return;
    main.post(() -> {
      try {
        SpeechRecognizer sr = SpeechRecognizer.createOnDeviceSpeechRecognizer(c);
        sr.triggerModelDownload(intent("device"));
        onDeviceEnglish = "pending";
        main.postDelayed(sr::destroy, 2000);
        main.postDelayed(() -> probe(c), 15000);
      } catch (Exception e) { Log.w(VoiceService.TAG, "stt download", e); lastError = e.toString(); }
    });
  }

  // ---------- one recognition ----------
  private final Context ctx;
  private final String kind;
  private final Out out;
  private SpeechRecognizer sr;
  private ParcelFileDescriptor readEnd, writeEnd;
  private final LinkedBlockingQueue<byte[]> queue = new LinkedBlockingQueue<>();
  private static final byte[] EOF = new byte[0];
  private volatile boolean finished = false;
  private final java.util.concurrent.CountDownLatch ready = new java.util.concurrent.CountDownLatch(1);

  VoiceStt(Context ctx, String kind, Out out) { this.ctx = ctx; this.kind = kind; this.out = out; }

  /** Set up the pipe and start the recogniser (on the main thread). Audio can be written straight away. */
  boolean start() {
    try {
      ParcelFileDescriptor[] p = ParcelFileDescriptor.createPipe();
      readEnd = p[0]; writeEnd = p[1];
    } catch (Exception e) { lastError = e.toString(); return false; }
    // a writer thread, so a slow reader never blocks the audio thread. It waits until the recogniser says it's
    // ready (audio sent before that can be dropped), then sends everything in order, the carried audio first.
    Thread w = new Thread(() -> {
      try (OutputStream os = new ParcelFileDescriptor.AutoCloseOutputStream(writeEnd)) {
        ready.await(4, java.util.concurrent.TimeUnit.SECONDS);
        while (true) { byte[] b = queue.take(); if (b == EOF) break; os.write(b); }
      } catch (Exception ignored) { }
    }, "hub-stt-writer");
    w.start();
    main.post(() -> {
      try {
        sr = "device".equals(kind) ? SpeechRecognizer.createOnDeviceSpeechRecognizer(ctx) : SpeechRecognizer.createSpeechRecognizer(ctx);
        sr.setRecognitionListener(listener);
        Intent i = intent(kind);
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, readEnd);
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
        i.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, 16000);
        sr.startListening(i);
      } catch (Exception e) {
        Log.w(VoiceService.TAG, "stt start", e); lastError = e.toString();
        done(); out.failed(SpeechRecognizer.ERROR_CLIENT, true);
      }
    });
    return true;
  }

  /** From the audio thread: 16 kHz mono PCM. */
  void write(short[] buf, int n) {
    if (finished) return;
    byte[] b = new byte[n * 2];
    for (int k = 0; k < n; k++) { b[2 * k] = (byte) buf[k]; b[2 * k + 1] = (byte) (buf[k] >> 8); }
    queue.offer(b);
  }

  /** You've stopped talking: end of the audio, so it gives its final answer. */
  void endInput() { queue.offer(EOF); }

  void cancel() {
    if (finished) return;
    done();
    main.post(() -> { try { if (sr != null) sr.cancel(); } catch (Exception ignored) { } });
  }

  private void done() {
    if (finished) return;
    finished = true;
    ready.countDown();
    queue.offer(EOF);
    main.post(() -> {
      try { if (sr != null) sr.destroy(); } catch (Exception ignored) { }
      try { if (readEnd != null) readEnd.close(); } catch (Exception ignored) { }
    });
  }

  private String committed = "", current = "";

  /** Same segment? A partial grows or changes its mind ("i like the" → "unlike the clouds") and shares words with
   *  the last one; a new segment starts over with different words ("hey qu" → "what"). */
  private static boolean startsLike(String later, String earlier) {
    java.util.Set<String> e = new java.util.HashSet<>(java.util.Arrays.asList(earlier.toLowerCase().split("\\s+")));
    for (String w : later.toLowerCase().split("\\s+")) if (e.contains(w)) return true;
    return false;
  }

  private static String best(Bundle b) {
    ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
    return r == null || r.isEmpty() || r.get(0) == null ? "" : r.get(0).trim();
  }

  private final RecognitionListener listener = new RecognitionListener() {
    @Override public void onReadyForSpeech(Bundle p) { ready.countDown(); VoiceService.emit("stt-ready"); }
    @Override public void onBeginningOfSpeech() { }
    @Override public void onRmsChanged(float rms) { }
    @Override public void onBufferReceived(byte[] buffer) { }
    @Override public void onEndOfSpeech() { }
    @Override public void onEvent(int type, Bundle p) { }
    // The on-device recogniser works in segments: its partials restart for each new stretch of speech, and the
    // final result may hold only the last one. So finished segments are kept and joined.
    @Override public void onPartialResults(Bundle b) {
      if (finished) return;
      String t = best(b);
      if (t.isEmpty()) return;
      if (!current.isEmpty() && !startsLike(t, current)) committed = (committed + " " + current).trim();   // a new segment began
      current = t;
      out.partial((committed + " " + current).trim());
    }
    @Override public void onResults(Bundle b) {
      if (finished) return;
      String t = best(b);
      if (!t.isEmpty() && !current.isEmpty() && !startsLike(t, current) && !startsLike(current, t)) committed = (committed + " " + current).trim();
      String all = (committed + " " + (t.isEmpty() ? current : t)).trim();
      done();
      out.result(all);
    }
    @Override public void onError(int code) {
      if (finished) return;
      done();
      // nothing heard / nothing matched: an ordinary "didn't catch that"; anything else: let Vosk do it
      boolean ordinary = code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
      if (!ordinary) {
        lastError = "speech recognition error " + code;
        lastCode = code == SpeechRecognizer.ERROR_NETWORK || code == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ? "network" : "stt_failed";
      }
      out.failed(code, !ordinary);
    }
  };
}
