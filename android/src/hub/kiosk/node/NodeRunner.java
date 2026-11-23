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
 * Result:   adb logcat -s NodeSpike   (the main process logs files/node/result.txt as it grows)
 *
 * The service runs in its own process (":node", see AndroidManifest.xml) because:
 *   - node::Start can run only once per process;
 *   - process.exit() in a script ends the whole process, which must not be ClaudeOS's own.
 * node::Start is called through JNA (already in the app for voice), so no NDK or JNI code is needed.
 * Android sends a process's stdout to /dev/null, so probe.cjs writes everything to result.txt.
 */
public final class NodeRunner extends Service {
  static final String TAG = "NodeSpike";
  private static boolean started;   // per process: the ":node" process runs Node at most once
  private static Memory argvBytes;  // kept alive: Node keeps pointers into argv
  private static Memory argvPtrs;

  /** The test hook (MainActivity, intent extra node_spike): start the service and log its result file. */
  public static void start(Context c) {
    Context app = c.getApplicationContext();
    File result = new File(new File(app.getFilesDir(), "node"), "result.txt");
    result.delete();
    app.startService(new Intent(app, NodeRunner.class));
    Handler ui = new Handler(Looper.getMainLooper());
    final String[] last = { "" };
    for (int s = 5; s <= 180; s += 5) {
      ui.postDelayed(() -> {
        try {
          if (!result.exists()) return;
          String text = new String(Files.readAllBytes(result.toPath()), StandardCharsets.UTF_8);
          if (text.equals(last[0])) return;
          Log.i(TAG, "result.txt:\n" + text);
          last[0] = text;
        } catch (Exception e) {
          Log.w(TAG, "read result", e);
        }
      }, s * 1000L);
    }
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    synchronized (NodeRunner.class) {
      if (started) { Log.i(TAG, "Node already ran in this process"); return START_NOT_STICKY; }
      started = true;
    }
    // V8 needs a large stack; Android's default thread stack is about 1 MB
    new Thread(null, this::runNode, "node", 16L * 1024 * 1024).start();
    return START_NOT_STICKY;
  }

  private void runNode() {
    try {
      File dir = new File(getFilesDir(), "node");
      dir.mkdirs();
      copyAsset(getAssets(), "node/claude-code/cli.js", new File(dir, "claude-code/cli.js"));
      copyAsset(getAssets(), "node/claude-code/package.json", new File(dir, "claude-code/package.json"));
      File probe = new File(dir, "probe.cjs");
      Files.write(probe.toPath(), PROBE.getBytes(StandardCharsets.UTF_8));

      System.loadLibrary("c++_shared");
      System.loadLibrary("node");
      Function start = NativeLibrary.getInstance("node").getFunction("_ZN4node5StartEiPPc");  // int node::Start(int, char**)
      String[] args = { "node", probe.getAbsolutePath(), dir.getAbsolutePath(), getCacheDir().getAbsolutePath() };
      Log.i(TAG, "starting node " + probe);
      int code = start.invokeInt(new Object[] { args.length, argv(args) });
      Log.i(TAG, "node exited with " + code);
    } catch (Throwable t) {
      Log.e(TAG, "node failed", t);
    }
    stopSelf();
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
    } catch (Exception e) {
      Log.w(TAG, "asset " + name + " missing (build with --node after setup-node.ts)");
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
      "process.exit = (code) => { log('claude exit ' + code); exit(code); };",
      "process.argv = [process.argv[0], cli, '--version'];",
      "log('claude: importing cli.js');",
      "import(url.pathToFileURL(cli).href).then(() => log('claude: cli.js loaded'), (e) => log('claude: import failed ' + (e && e.stack || e)));",
      "");
}
