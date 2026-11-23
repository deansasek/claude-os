package hub.kiosk.node;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import com.sun.jna.Function;
import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.NativeLibrary;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * SPIKE: runs embedded Node.js (nodejs-mobile, libnode.so) on the tablet once, to test whether Node and the
 * Claude Code CLI run there. Not a feature.
 *
 * Trigger:  adb shell am start -n hub.kiosk/.MainActivity --ez node_spike true
 * Result:   adb logcat -s NodeSpike   (both processes log every step and files/node/result.txt: lines from
 *           the ":node" process start "node: ", lines from the main process start "main: ").
 *           The main process also POSTs result.txt and its log lines to the hub (POST /api/spike/node), which
 *           appends them to host/logs/spike-node.log on the PC; the :node process POSTs its own failure.
 *
 * The service runs in its own process (":node", see AndroidManifest.xml) because:
 *   - node::Start can run only once per process;
 *   - process.exit() in a script ends the whole process, which must not be ClaudeOS's own.
 * node::Start is called through JNA (already in the app for voice), so no NDK or JNI code is needed.
 * Android sends a process's stdout to /dev/null, so probe.cjs writes everything to result.txt.
 */
public final class NodeRunner extends Service {
  public static final String TAG = "NodeSpike";
  private static final int LINE = 800;   // logcat cuts entries near 4 KB; short lines are easier to read
  private static boolean started;   // per process: the ":node" process runs Node at most once
  private static Memory argvBytes;  // kept alive: Node keeps pointers into argv
  private static Memory argvPtrs;

  private static final int SEND_MAX = 60 * 1024;   // the hub's route takes up to 64 KB
  private static final StringBuilder steps = new StringBuilder();   // this process's log lines, sent to the hub
  private static String hub = "";   // the hub's origin, e.g. http://10.0.0.246:8000 (from HubConfig, via MainActivity)

  /** Logs one line under TAG and keeps it for the report to the hub. */
  static void step(String msg) {
    Log.i(TAG, msg);
    synchronized (steps) { steps.append(msg).append('\n'); }
  }

  static void stepError(String msg, Throwable t) {
    Log.e(TAG, msg, t);
    synchronized (steps) { steps.append(msg).append(": ").append(Log.getStackTraceString(t)).append('\n'); }
  }

  /** The origin (scheme, host, port) of a page URL such as http://10.0.0.246:8000/?device=tablet; "" when it is not a URL. */
  static String origin(String pageUrl) {
    try {
      java.net.URI u = java.net.URI.create(pageUrl);
      if (u.getScheme() == null || u.getHost() == null) return "";
      return u.getScheme() + "://" + u.getHost() + (u.getPort() == -1 ? "" : ":" + u.getPort());
    } catch (Exception e) {
      return "";
    }
  }

  /**
   * POSTs the result text and this process's log lines to the hub (POST /api/spike/node, logged on the PC in
   * host/logs/spike-node.log) on a background thread. The device log and the app's files can't be read on this
   * build, so this is how the result reaches the user. Logcat keeps the same lines.
   */
  static void sendToHub(String what, String result) {
    final String base = hub;
    String log;
    synchronized (steps) { log = steps.toString(); }
    String head = what + " (pid " + android.os.Process.myPid() + ")\n----- result.txt -----\n"
        + (result.isEmpty() ? "(empty or missing)" : result) + "\n----- log lines -----\n";
    int room = Math.max(0, SEND_MAX / 4 - head.length());   // UTF-8 is at most 4 bytes a char: stays under SEND_MAX bytes
    if (log.length() > room) log = "(earlier lines cut)\n" + log.substring(log.length() - room);
    final byte[] body = (head + log).getBytes(StandardCharsets.UTF_8);
    Thread t = new Thread(() -> {
      if (base.isEmpty()) { Log.e(TAG, "send: no hub address"); return; }
      java.net.HttpURLConnection c = null;
      try {
        c = (java.net.HttpURLConnection) java.net.URI.create(base + "/api/spike/node").toURL().openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(10_000);
        c.setReadTimeout(10_000);
        c.setDoOutput(true);
        c.setFixedLengthStreamingMode(body.length);
        c.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
        c.setRequestProperty("X-Spike", "node");
        try (OutputStream out = c.getOutputStream()) { out.write(body); }
        Log.i(TAG, "send: " + what + " to " + base + " answered " + c.getResponseCode());
      } catch (Throwable e) {
        Log.e(TAG, "send: " + what + " to " + base + " failed", e);
      } finally {
        if (c != null) c.disconnect();
      }
    }, "node-send");
    t.start();
  }

  /** Logs text under TAG, one logcat line per text line, long lines split into LINE-sized parts. */
  static void logText(String prefix, String text) {
    for (String line : text.split("\n", -1)) {
      if (line.isEmpty()) continue;
      for (int i = 0; i < line.length(); i += LINE) {
        step(prefix + line.substring(i, Math.min(line.length(), i + LINE)));
      }
    }
  }

  private static String read(File f) throws Exception {
    return f.exists() ? new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8) : "";
  }

  /** True when probe.cjs has written its last line (or Node failed before it could). */
  private static boolean finished(String text) {
    return text.contains("claude exit ") || text.contains("claude: cli.js loaded")
        || text.contains("claude: import failed") || text.contains("claude: cli.js missing");
  }

  /**
   * The test hook (MainActivity, intent extra node_spike), in the main process: start the service, then log
   * each new line of the result file ("main: ") and, when the probe finishes or after 180 s, the full file.
   */
  public static void start(Context c, String hubPageUrl) {
    hub = origin(hubPageUrl);
    Context app = c.getApplicationContext();
    File result = new File(new File(app.getFilesDir(), "node"), "result.txt");
    step("main: hook started, deleting old " + result + " (existed: " + result.exists() + ")");
    result.delete();
    try {
      app.startService(new Intent(app, NodeRunner.class).putExtra("hub", hub));
      step("main: startService sent for :node, reporting to " + hub);
    } catch (Throwable t) {
      stepError("main: startService failed", t);
      sendToHub("main: startService failed", "");
      return;
    }
    Handler ui = new Handler(Looper.getMainLooper());
    final int[] seen = { 0 };
    final boolean[] done = { false };
    for (int s = 2; s <= 180; s += 2) {
      final int at = s;
      ui.postDelayed(() -> {
        if (done[0]) return;
        try {
          String text = read(result);
          if (text.length() > seen[0]) {
            logText("main: ", text.substring(seen[0]));
            seen[0] = text.length();
          }
          if (finished(text) || at == 180) {
            done[0] = true;
            step("main: ===== result.txt after " + at + " s (" + (finished(text) ? "finished" : "timed out") + ") =====");
            logText("main: | ", text.isEmpty() ? "(empty or missing)" : text);
            step("main: ===== end =====");
            sendToHub("main: result after " + at + " s (" + (finished(text) ? "finished" : "timed out") + ")", text);
          }
        } catch (Throwable t) {
          stepError("main: reading result.txt failed", t);
          if (!done[0]) { done[0] = true; sendToHub("main: reading result.txt failed", ""); }
        }
      }, s * 1000L);
    }
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && intent.getStringExtra("hub") != null) hub = intent.getStringExtra("hub");
    step("node: service onStartCommand, pid " + android.os.Process.myPid());
    synchronized (NodeRunner.class) {
      if (started) { step("node: Node already ran in this process (force-stop the app to run again)"); return START_NOT_STICKY; }
      started = true;
    }
    // V8 needs a large stack; Android's default thread stack is about 1 MB
    new Thread(null, this::runNode, "node", 16L * 1024 * 1024).start();
    return START_NOT_STICKY;
  }

  private void runNode() {
    File dir = new File(getFilesDir(), "node");
    File result = new File(dir, "result.txt");
    Thread tail = null;
    boolean failed = false;
    try {
      dir.mkdirs();
      copyAsset(getAssets(), "node/claude-code/cli.js", new File(dir, "claude-code/cli.js"));
      copyAsset(getAssets(), "node/claude-code/package.json", new File(dir, "claude-code/package.json"));
      File probe = new File(dir, "probe.cjs");
      Files.write(probe.toPath(), PROBE.getBytes(StandardCharsets.UTF_8));
      step("node: wrote " + probe);

      // cli.js may call process.exit, which ends this process inside node::Start: a tail thread logs result.txt
      // as it grows, so the lines reach logcat even if the code after node::Start never runs.
      tail = new Thread(() -> tail(result), "node-tail");
      tail.setDaemon(true);
      tail.start();

      System.loadLibrary("c++_shared");
      step("node: loaded libc++_shared.so");
      System.loadLibrary("node");
      step("node: loaded libnode.so");
      Function start = NativeLibrary.getInstance("node").getFunction("_ZN4node5StartEiPPc");  // int node::Start(int, char**)
      step("node: found node::Start");
      String[] args = { "node", probe.getAbsolutePath(), dir.getAbsolutePath(), getCacheDir().getAbsolutePath() };
      step("node: starting node " + probe);
      int code = start.invokeInt(new Object[] { args.length, argv(args) });
      step("node: node::Start returned " + code);
    } catch (Throwable t) {
      stepError("node: failed", t);
      failed = true;
    }
    if (tail != null) tail.interrupt();
    try {
      String text = read(result);
      step("node: ===== result.txt =====");
      logText("node: | ", text.isEmpty() ? "(empty or missing)" : text);
      step("node: ===== end =====");
      // the main process sends the result when the probe finishes; this process sends only its own failure,
      // with the exception text, because cli.js can end this process before the code here runs
      if (failed) sendToHub("node: failed", text);
    } catch (Throwable t) {
      stepError("node: reading result.txt failed", t);
    }
    stopSelf();
  }

  /** In the :node process: logs each new part of result.txt ("node: ") every 100 ms. */
  private static void tail(File result) {
    int seen = 0;
    while (!Thread.currentThread().isInterrupted()) {
      try {
        String text = read(result);
        if (text.length() > seen) {
          logText("node: ", text.substring(seen));
          seen = text.length();
        }
        Thread.sleep(100);
      } catch (InterruptedException e) {
        return;
      } catch (Throwable t) {
        stepError("node: tail failed", t);
        return;
      }
    }
  }

  /** argv as Node wants it: all strings in one contiguous block (libuv reuses it for the process title). */
  private static Memory argv(String[] args) {
    byte[][] parts = new byte[args.length][];
    long total = 0;
    for (int i = 0; i < args.length; i++) {
      parts[i] = args[i].getBytes(StandardCharsets.UTF_8);
      total += parts[i].length + 1;
    }
    argvBytes = new Memory(total);
    argvBytes.clear();
    argvPtrs = new Memory((long) Native.POINTER_SIZE * (args.length + 1));
    long off = 0;
    for (int i = 0; i < args.length; i++) {
      argvBytes.write(off, parts[i], 0, parts[i].length);
      argvPtrs.setPointer((long) i * Native.POINTER_SIZE, argvBytes.share(off));
      off += parts[i].length + 1;
    }
    argvPtrs.setPointer((long) args.length * Native.POINTER_SIZE, null);
    return argvPtrs;
  }

  private static void copyAsset(AssetManager am, String name, File to) {
    try (InputStream in = am.open(name)) {
      to.getParentFile().mkdirs();
      try (OutputStream out = new FileOutputStream(to)) {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
      }
      step("node: copied asset " + name + " (" + to.length() + " bytes)");
    } catch (Exception e) {
      stepError("node: asset " + name + " missing (build with --node after setup-node.ts)", e);
    }
  }

  @Override public IBinder onBind(Intent intent) { return null; }

  /**
   * Step 1 writes the time and process.version. Step 2 runs Claude Code's cli.js with --version in the same
   * Node, with stdout, stderr and process.exit captured into result.txt.
   */
  private static final String PROBE = String.join("\n",
      "const fs = require('fs'), path = require('path'), url = require('url');",
      "const [dir, tmp] = process.argv.slice(2);",
      "const out = path.join(dir, 'result.txt');",
      "const log = (s) => fs.appendFileSync(out, s + '\\n');",
      "log('time ' + new Date().toISOString());",
      "log('node ' + process.version + ' ' + process.platform + ' ' + process.arch);",
      "process.on('uncaughtException', (e) => log('uncaught ' + (e && e.stack || e)));",
      "process.on('unhandledRejection', (e) => log('unhandled ' + (e && e.stack || e)));",
      "const cli = path.join(dir, 'claude-code', 'cli.js');",
      "if (!fs.existsSync(cli)) { log('claude: cli.js missing'); return; }",
      "process.env.HOME = dir; process.env.TMPDIR = tmp;",
      "process.stdout.write = (c) => { log('stdout ' + String(c).trimEnd()); return true; };",
      "process.stderr.write = (c) => { log('stderr ' + String(c).trimEnd()); return true; };",
      "const exit = process.exit.bind(process);",
      // wait before the real exit, so the Java tail thread logs the last lines before the process ends
      "let exiting = false;",
      "process.exit = (code) => { if (exiting) return; exiting = true; log('claude exit ' + code); setTimeout(() => exit(code), 500); };",
      "process.argv = [process.argv[0], cli, '--version'];",
      "log('claude: importing cli.js');",
      "import(url.pathToFileURL(cli).href).then(() => log('claude: cli.js loaded'), (e) => log('claude: import failed ' + (e && e.stack || e)));",
      "");
}
