package hub.kiosk.node;

import android.content.Context;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.zip.GZIPInputStream;

/**
 * SPIKE: tests whether Claude Code's native linux-arm64-musl binary runs on the tablet through a bundled musl
 * loader. Not a feature.
 *
 * The APK bundles Alpine's musl dynamic loader (ld-musl-aarch64.so.1, musl 1.2.6-r3) as lib/arm64-v8a/libmuslld.so,
 * so the installer extracts it to nativeLibraryDir, where the app may execute files. The runner downloads the
 * latest @anthropic-ai/claude-code-linux-arm64-musl from the npm registry into files/claude/, then runs:
 *   libmuslld.so --library-path nativeLibraryDir files/claude/claude --version
 * The binary itself is not changed.
 *
 * Trigger:  adb shell am start -n hub.kiosk/.MainActivity --ez node_spike true
 *           add --ez login_spike true to also run `claude auth login` (up to 180 s; see run()).
 * Result:   every line is POSTed to the hub (POST /api/spike/node, header X-Spike: node), which appends it to
 *           host/logs/spike-node.log on the PC. Logcat tag NodeSpike has the same lines.
 */
public final class NativeClaudeRunner {
  private static final String TAG = NodeRunner.TAG;
  private static final String META = "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-arm64-musl/latest";
  private static final String LOADER = "libmuslld.so";
  private static boolean running;

  private final Context app;
  private final String hub;
  private final ExecutorService sender = Executors.newSingleThreadExecutor();   // keeps the lines in order

  private NativeClaudeRunner(Context app, String hub) {
    this.app = app;
    this.hub = hub;
  }

  /** The test hook (MainActivity, intent extra node_spike): runs the test once on a background thread. */
  public static void start(Context c, String hubPageUrl, boolean login) {
    synchronized (NativeClaudeRunner.class) {
      if (running) { Log.i(TAG, "native: already running"); return; }
      running = true;
    }
    NativeClaudeRunner r = new NativeClaudeRunner(c.getApplicationContext(), NodeRunner.origin(hubPageUrl));
    new Thread(() -> {
      try {
        r.run(login);
      } catch (Throwable t) {
        r.post("native: failed: " + Log.getStackTraceString(t));
      } finally {
        r.post("native: done");
        r.sender.shutdown();
        synchronized (NativeClaudeRunner.class) { running = false; }
      }
    }, "native-claude").start();
  }

  private void run(boolean login) throws Exception {
    String libDir = app.getApplicationInfo().nativeLibraryDir;
    File loader = new File(libDir, LOADER);
    post("native: start, pid " + android.os.Process.myPid() + ", sdk " + android.os.Build.VERSION.SDK_INT
        + ", abi " + android.os.Build.SUPPORTED_ABIS[0]);
    post("native: nativeLibraryDir " + libDir + ", loader exists " + loader.exists() + ", size " + loader.length()
        + ", canExecute " + loader.canExecute());
    String[] libs = new File(libDir).list();
    post("native: nativeLibraryDir files " + (libs == null ? "(cannot list)" : String.join(" ", libs)));

    // 1. the loader alone: shows whether the app may execute it at all (musl prints its usage and version)
    exec("loader-only", List.of(loader.getAbsolutePath()), Map.of(), 60, true);

    // 2. the binary from the npm registry
    File dir = new File(app.getFilesDir(), "claude");
    File bin = download(dir);
    if (bin == null) return;
    bin.setExecutable(true, true);
    post("native: binary " + bin + ", size " + bin.length() + ", canExecute " + bin.canExecute());

    // 3. the binary through the loader
    exec("claude", List.of(loader.getAbsolutePath(), "--library-path", libDir, bin.getAbsolutePath(), "--version"),
        Map.of(), 60, true);

    // 4. LOGIN SPIKE (intent extra login_spike): the official `claude auth login`, to see the sign-in address it
    //    prints and whether it waits for the browser callback on the tablet's loopback.
    //    The spike never reads files/claude/, ~/.claude or any .credentials file, and never sends their content
    //    anywhere: it only forwards the CLI's own stdout and stderr lines. The CLI writes its sign-in result itself.
    //    BROWSER=echo stops the CLI from trying to open a browser on Android. stdin stays open, so the CLI does not
    //    see end-of-input while it waits.
    if (login) {
      exec("login", List.of(loader.getAbsolutePath(), "--library-path", libDir, bin.getAbsolutePath(), "auth", "login"),
          Map.of("DISABLE_AUTOUPDATER", "1", "BROWSER", "echo"), 180, false);
    }
  }

  /** Downloads and unpacks the latest package into dir (skipped when that version is already there). */
  private File download(File dir) throws Exception {
    String meta = new String(get(META).readAllBytes(), StandardCharsets.UTF_8);
    String version = field(meta, "version");
    String tarball = field(meta, "tarball");
    String integrity = field(meta, "integrity");
    post("native: npm latest " + version + ", " + tarball);
    File bin = new File(dir, "claude");
    File stamp = new File(dir, "version.txt");
    if (bin.exists() && stamp.exists()
        && new String(java.nio.file.Files.readAllBytes(stamp.toPath()), StandardCharsets.UTF_8).equals(version)) {
      post("native: " + version + " already unpacked, download skipped");
      return bin;
    }
    dir.mkdirs();
    bin.delete();
    stamp.delete();
    long t0 = System.currentTimeMillis();
    MessageDigest sha = MessageDigest.getInstance("SHA-512");
    boolean found = false;
    try (DigestInputStream raw = new DigestInputStream(get(tarball), sha);
         InputStream tar = new GZIPInputStream(raw, 64 * 1024)) {
      byte[] head = new byte[512];
      while (readFully(tar, head)) {
        if (head[0] == 0) break;   // end of archive
        String name = cstr(head, 0, 100);
        String prefix = cstr(head, 345, 155);
        if (!prefix.isEmpty()) name = prefix + "/" + name;
        long size = Long.parseLong(cstr(head, 124, 12).trim(), 8);
        char type = (char) head[156];
        long padded = (size + 511) / 512 * 512;
        if ((type == '0' || type == 0) && name.equals("package/claude")) {
          post("native: unpacking " + name + " (" + size + " bytes)");
          try (OutputStream out = new FileOutputStream(bin)) { copy(tar, out, size); }
          skip(tar, padded - size);
          found = true;
        } else {
          skip(tar, padded);
        }
      }
      byte[] rest = new byte[64 * 1024];
      while (raw.read(rest) > 0) { /* read to the end, so the hash covers the whole tarball */ }
    }
    String got = "sha512-" + Base64.getEncoder().encodeToString(sha.digest());
    post("native: download took " + (System.currentTimeMillis() - t0) / 1000 + " s, integrity "
        + (got.equals(integrity) ? "matches" : "MISMATCH (got " + got + ", want " + integrity + ")"));
    if (!found) { post("native: package/claude not in the tarball"); return null; }
    if (!got.equals(integrity)) { bin.delete(); return null; }
    java.nio.file.Files.write(stamp.toPath(), version.getBytes(StandardCharsets.UTF_8));
    return bin;
  }

  /**
   * Runs a command with HOME and TMPDIR in the app's files folder plus extra env; posts its output lines and exit
   * code. Kills it after timeoutSec and reports whether it exited by itself or was still running.
   */
  private void exec(String what, List<String> cmd, Map<String, String> env, int timeoutSec, boolean closeStdin) {
    post("native: " + what + ": exec " + String.join(" ", cmd) + (env.isEmpty() ? "" : ", env " + env));
    try {
      File home = app.getFilesDir();
      File tmp = new File(home, "tmp");
      tmp.mkdirs();
      ProcessBuilder pb = new ProcessBuilder(new ArrayList<>(cmd)).directory(home);
      pb.environment().put("HOME", home.getAbsolutePath());
      pb.environment().put("TMPDIR", tmp.getAbsolutePath());
      pb.environment().putAll(env);
      long t0 = System.currentTimeMillis();
      Process p = pb.start();
      if (closeStdin) p.getOutputStream().close();
      Thread out = pipe(p.getInputStream(), what + " stdout");
      Thread err = pipe(p.getErrorStream(), what + " stderr");
      if (p.waitFor(timeoutSec, TimeUnit.SECONDS)) {
        post("native: " + what + ": exited by itself after " + (System.currentTimeMillis() - t0) / 1000 + " s");
      } else {
        post("native: " + what + ": STILL RUNNING (waiting) after " + timeoutSec + " s, killing");
        p.destroyForcibly();
        p.waitFor(5, TimeUnit.SECONDS);
      }
      out.join(2000);
      err.join(2000);
      post("native: " + what + ": exit code " + p.exitValue());
    } catch (Throwable t) {
      post("native: " + what + ": exception " + Log.getStackTraceString(t));
    }
  }

  private Thread pipe(InputStream in, String label) {
    Thread t = new Thread(() -> {
      try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
        String line;
        while ((line = r.readLine()) != null) {
          // mark lines with an address (the sign-in URL), so they stand out in the log; the spike never opens them
          post("native: " + label + ": " + (line.contains("http") ? "[URL LINE] " : "") + line);
        }
      } catch (Exception e) {
        post("native: " + label + " read failed: " + e);
      }
    }, "native-pipe");
    t.start();
    return t;
  }

  /** Logs one line and POSTs it to the hub, in order, on the sender thread. */
  private void post(String line) {
    Log.i(TAG, line);
    if (hub.isEmpty() || sender.isShutdown()) return;
    final byte[] body = line.getBytes(StandardCharsets.UTF_8);
    sender.execute(() -> {
      HttpURLConnection c = null;
      try {
        c = (HttpURLConnection) URI.create(hub + "/api/spike/node").toURL().openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(10_000);
        c.setReadTimeout(10_000);
        c.setDoOutput(true);
        c.setFixedLengthStreamingMode(body.length);
        c.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
        c.setRequestProperty("X-Spike", "node");
        try (OutputStream o = c.getOutputStream()) { o.write(body); }
        c.getResponseCode();
      } catch (Throwable e) {
        Log.e(TAG, "native: send to " + hub + " failed", e);
      } finally {
        if (c != null) c.disconnect();
      }
    });
  }

  private static InputStream get(String url) throws Exception {
    HttpURLConnection c = (HttpURLConnection) URI.create(url).toURL().openConnection();
    c.setConnectTimeout(15_000);
    c.setReadTimeout(60_000);
    c.setInstanceFollowRedirects(true);
    int code = c.getResponseCode();
    if (code != 200) throw new IllegalStateException(url + " answered " + code);
    return c.getInputStream();
  }

  /** The first "key":"value" string in a JSON text. */
  private static String field(String json, String key) {
    java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]*)\"").matcher(json);
    if (!m.find()) throw new IllegalStateException("no " + key + " in the npm metadata");
    return m.group(1);
  }

  private static String cstr(byte[] b, int off, int len) {
    int end = off;
    while (end < off + len && b[end] != 0) end++;
    return new String(b, off, end - off, StandardCharsets.UTF_8);
  }

  private static boolean readFully(InputStream in, byte[] buf) throws Exception {
    int n = 0;
    while (n < buf.length) {
      int r = in.read(buf, n, buf.length - n);
      if (r < 0) return false;
      n += r;
    }
    return true;
  }

  private void copy(InputStream in, OutputStream out, long size) throws Exception {
    byte[] buf = new byte[256 * 1024];
    long left = size, next = 50L << 20;
    while (left > 0) {
      int r = in.read(buf, 0, (int) Math.min(buf.length, left));
      if (r < 0) throw new IllegalStateException("tarball ended early");
      out.write(buf, 0, r);
      left -= r;
      if (size - left >= next) { post("native: unpacked " + ((size - left) >> 20) + " MB"); next += 50L << 20; }
    }
  }

  private static void skip(InputStream in, long n) throws Exception {
    byte[] buf = new byte[8192];
    while (n > 0) {
      int r = in.read(buf, 0, (int) Math.min(buf.length, n));
      if (r < 0) return;
      n -= r;
    }
  }
}
