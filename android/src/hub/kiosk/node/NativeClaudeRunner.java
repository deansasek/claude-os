package hub.kiosk.node;

import android.content.Context;
import android.util.Log;

import hub.kiosk.MainActivity;

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
 *           add --ez login_spike true to also sign the CLI in: `claude auth login` with ClaudeOS's Browser and code
 *           sheet (up to 10 minutes; see login()), then `claude auth status`.
 *           add --ez run_prompt true [--es prompt "<text>"] to run one `claude -p <prompt> --model haiku
 *           --output-format text` session with the stored sign-in (up to 3 minutes; default prompt TEST_PROMPT).
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
  public static void start(Context c, String hubPageUrl, boolean login, String prompt) {
    synchronized (NativeClaudeRunner.class) {
      if (running) { Log.i(TAG, "native: already running"); return; }
      running = true;
    }
    NativeClaudeRunner r = new NativeClaudeRunner(c.getApplicationContext(), NodeRunner.origin(hubPageUrl));
    new Thread(() -> {
      try {
        r.run(login, prompt);
      } catch (Throwable t) {
        r.post("native: failed: " + Log.getStackTraceString(t));
      } finally {
        r.post("native: done");
        r.sender.shutdown();
        synchronized (NativeClaudeRunner.class) { running = false; }
      }
    }, "native-claude").start();
  }

  private void run(boolean login, String prompt) throws Exception {
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

    // 4. CLI SIGN-IN (intent extra login_spike): the official `claude auth login`, then `claude auth status`.
    //    See login() for the flow. BROWSER=echo stops the CLI from trying to open a browser on Android.
    //    musl has no DNS config on Android (no /etc/resolv.conf), so the CLI cannot resolve names itself: its
    //    requests go through LoopbackProxy, which resolves each host with Android's resolver.
    //
    // 5. PROMPT (intent extra run_prompt, optional string extra prompt): one `claude -p` session with Haiku, through
    //    the same proxy and environment as the sign-in. Uses the sign-in the CLI stored; ClaudeOS never reads it.
    if (login || prompt != null) {
      List<String> base = List.of(loader.getAbsolutePath(), "--library-path", libDir, bin.getAbsolutePath());
      try (LoopbackProxy proxy = LoopbackProxy.start(this::post)) {
        post("native: proxy: listening on " + proxy.url());
        Map<String, String> env = Map.of("DISABLE_AUTOUPDATER", "1", "BROWSER", "echo",
            "HTTPS_PROXY", proxy.url(), "HTTP_PROXY", proxy.url(), "NO_PROXY", "localhost,127.0.0.1");
        if (login) {
          login(base, env);
          // the status, as the CLI reports it; only these fields reach the hub log (not the email or the organization)
          exec("status", concat(base, "auth", "status"), env, 60, true,
              l -> l.matches("\\s*\"(loggedIn|authMethod|subscriptionType)\".*") ? l : null);
        }
        if (prompt != null) {
          // the prompt is an argument (no shell); the log shows at most its first 60 characters
          String shown = prompt.length() > 60 ? prompt.substring(0, 60) + "..." : prompt;
          exec("prompt", concat(base, "-p", prompt, "--model", "haiku", "--output-format", "text"), env,
              PROMPT_MAX_SEC, true, NativeClaudeRunner::redact,
              "claude -p \"" + shown + "\" --model haiku --output-format text");
        }
      }
      post("native: proxy: stopped");
    }
  }

  /** The prompt when the intent has run_prompt but no prompt extra. */
  public static final String TEST_PROMPT = "Reply with the word hello and nothing else";
  private static final int PROMPT_MAX_SEC = 180;   // the prompt session may run up to 3 minutes

  // ---------- CLI sign-in ----------
  // The flow: the CLI prints its sign-in address; the runner hands it to the page, which opens it in ClaudeOS's own
  // Browser app. The user signs in on claude.ai. While the CLI takes a code (its manual flow, or its "Paste code"
  // prompt), the Browser's bar shows "Enter sign-in code" with the time left; only a tap opens the ClaudeOS sheet. Its
  // Paste reads the clipboard (Bridge.cliSigninClipboard), its Send sends the code (Bridge.cliSigninCode), and
  // sendCode() writes it plus a newline to the CLI's stdin, then closes stdin. The CLI, not ClaudeOS, exchanges the
  // code for the token and stores it itself.
  // ClaudeOS never reads files/claude/, ~/.claude or the CLI's credentials file, never stores the token or the code,
  // and never logs the code: the code only passes from the clipboard or the sheet straight into the CLI's stdin.
  // Posted lines have addresses and long tokens masked (redact()).

  private static final long LOGIN_MAX_SEC = 600;   // the CLI waits at most 10 minutes for the user
  private static final String AUTHORIZE = "https://claude.ai/oauth/authorize";
  private static final java.util.regex.Pattern PROMPT = java.util.regex.Pattern.compile("(?i)paste.{0,20}code|code.{0,20}here");
  /** The waiting CLI's stdin while it may take a code; null otherwise. */
  private static volatile OutputStream loginIn;
  /** When the runner stops the waiting login (System.currentTimeMillis()); 0 when no login runs. */
  private static volatile long loginDeadline;

  /** Seconds left for the running login, or -1 when no login takes a code (Bridge.cliSigninState). */
  public static long secondsLeft() {
    long d = loginDeadline;
    if (loginIn == null || d == 0) return -1;
    return Math.max(0, (d - System.currentTimeMillis()) / 1000);
  }

  /**
   * The sheet's Paste (Bridge.cliSigninClipboard): the clipboard's text, read natively because the WebView's own
   * clipboard read is blocked. Only while a login takes a code, so the page gets no general clipboard read. Puts the
   * text in out and returns null, else returns a short reason. Never logs the text.
   */
  public static String clipboardCode(Context c, StringBuilder out) {
    if (loginIn == null) return "no sign-in is waiting";
    String text = "";
    try {
      android.content.ClipboardManager cm = c.getSystemService(android.content.ClipboardManager.class);
      android.content.ClipData clip = cm == null ? null : cm.getPrimaryClip();
      if (clip != null && clip.getItemCount() > 0) text = String.valueOf(clip.getItemAt(0).coerceToText(c)).trim();
    } catch (Exception e) { /* no clipboard: the reason below */ }
    if (text.isEmpty() || text.length() > 2048 || text.contains("\n")) return "no code to send";
    out.append(text);
    return null;
  }

  /**
   * The sheet's code for the waiting CLI (Bridge.cliSigninCode): an empty code means the clipboard's text. Writes it
   * plus a newline to the CLI's stdin and closes stdin. Returns null when sent, else a short reason. Never logs the code.
   */
  public static String sendCode(Context c, String code) {
    OutputStream in;
    synchronized (NativeClaudeRunner.class) { in = loginIn; loginIn = null; }
    if (in == null) return "no sign-in is waiting";
    String text = code == null ? "" : code.trim();
    if (text.isEmpty()) {
      try {
        android.content.ClipboardManager cm = c.getSystemService(android.content.ClipboardManager.class);
        android.content.ClipData clip = cm == null ? null : cm.getPrimaryClip();
        if (clip != null && clip.getItemCount() > 0) text = String.valueOf(clip.getItemAt(0).coerceToText(c)).trim();
      } catch (Exception e) { /* no clipboard: the reason below */ }
    }
    if (text.isEmpty() || text.length() > 2048 || text.contains("\n")) {
      synchronized (NativeClaudeRunner.class) { if (loginIn == null) loginIn = in; }   // still waiting: try again
      return "no code to send";
    }
    try {
      in.write((text + "\n").getBytes(StandardCharsets.UTF_8));
      in.flush();
      in.close();
      return null;
    } catch (Exception e) {
      return "the sign-in has ended";
    }
  }

  /**
   * The page's step: {"step":"open","code":bool,"left":s} | {"step":"code","left":s} | {"step":"done","ok":bool}.
   * left: seconds until the runner stops the login. The page never opens the code sheet by itself (core/web/cli-signin.ts).
   */
  private static void toPage(String json) {
    try { MainActivity.cliSignin(json); } catch (Throwable t) { Log.e(TAG, "native: page step failed", t); }
  }

  private static long left() { return Math.max(0, (loginDeadline - System.currentTimeMillis()) / 1000); }

  private void login(List<String> base, Map<String, String> env) {
    post("native: login: exec auth login");
    android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
    boolean[] codeAsked = { false };
    Runnable askCode = () -> {
      synchronized (codeAsked) { if (codeAsked[0]) return; codeAsked[0] = true; }
      post("native: login: the CLI takes a code now; the Browser shows Enter sign-in code");
      toPage("{\"step\":\"code\",\"left\":" + left() + "}");
    };
    Process p = null;
    try {
      File home = app.getFilesDir();
      File tmp = new File(home, "tmp");
      tmp.mkdirs();
      ProcessBuilder pb = new ProcessBuilder(concat(base, "auth", "login")).directory(home);
      pb.environment().put("HOME", home.getAbsolutePath());
      pb.environment().put("TMPDIR", tmp.getAbsolutePath());
      pb.environment().putAll(env);
      long t0 = System.currentTimeMillis();
      loginDeadline = t0 + LOGIN_MAX_SEC * 1000;
      p = pb.start();
      loginIn = p.getOutputStream();   // stdin stays open: the CLI may wait for a pasted code
      Thread out = loginReader(p.getInputStream(), "stdout", askCode, ui);
      Thread err = loginReader(p.getErrorStream(), "stderr", askCode, ui);
      if (p.waitFor(LOGIN_MAX_SEC, TimeUnit.SECONDS)) {
        post("native: login: exited by itself after " + (System.currentTimeMillis() - t0) / 1000 + " s");
      } else {
        post("native: login: still waiting after " + LOGIN_MAX_SEC + " s, stopping it");
        p.destroyForcibly();
        p.waitFor(5, TimeUnit.SECONDS);
      }
      out.join(2000);
      err.join(2000);
      int code = p.exitValue();
      post("native: login: exit code " + code);
      toPage("{\"step\":\"done\",\"ok\":" + (code == 0) + "}");
    } catch (Throwable t) {
      post("native: login: exception " + t);
      toPage("{\"step\":\"done\",\"ok\":false}");
      if (p != null) p.destroyForcibly();
    } finally {
      loginIn = null;
      loginDeadline = 0;
    }
  }

  /**
   * Reads the CLI's output by characters (a prompt has no newline): finds the sign-in address (it may wrap onto
   * following lines), sends it to the page once, and calls askCode when the CLI asks for a code. Posts redacted lines.
   */
  private Thread loginReader(InputStream in, String label, Runnable askCode, android.os.Handler ui) {
    Thread t = new Thread(() -> {
      StringBuilder line = new StringBuilder();
      StringBuilder url = new StringBuilder();
      boolean[] sent = { false };
      Runnable open = () -> {
        synchronized (url) {
          if (sent[0] || url.length() == 0) return;
          sent[0] = true;
          openSignin(url.toString(), askCode);
        }
      };
      char[] buf = new char[4096];
      try (InputStreamReader r = new InputStreamReader(in, StandardCharsets.UTF_8)) {
        int n;
        while ((n = r.read(buf)) > 0) {
          for (int i = 0; i < n; i++) {
            char ch = buf[i];
            if (ch != '\n' && ch != '\r') { line.append(ch); continue; }
            String l = strip(line.toString());
            line.setLength(0);
            if (l.isEmpty()) continue;
            boolean grew = false;
            synchronized (url) {
              int at = l.indexOf(AUTHORIZE);
              if (at >= 0 && url.length() == 0) { url.append(l.substring(at).split("\\s")[0]); grew = true; }
              else if (url.length() > 0 && !sent[0] && l.matches("[A-Za-z0-9%&=_.~+/?#:\\-]+")) { url.append(l); grew = true; }   // wrapped
            }
            ui.removeCallbacks(open);
            if (grew) ui.postDelayed(open, 800);   // the address is whole after a quiet moment
            else ui.post(open);                    // or as soon as another line follows it
            if (PROMPT.matcher(l).find()) askCode.run();
            post("native: login " + label + ": " + redact(l));
          }
          if (PROMPT.matcher(strip(line.toString())).find()) { ui.post(open); askCode.run(); }   // a prompt with no newline
        }
        String rest = strip(line.toString());
        if (!rest.isEmpty()) post("native: login " + label + ": " + redact(rest));
      } catch (Exception e) {
        post("native: login " + label + " read ended: " + e.getClass().getSimpleName());
      }
    }, "native-login-" + label);
    t.start();
    return t;
  }

  /** The sign-in address to the page (ClaudeOS's Browser). code: claude.ai shows a code to copy (no localhost callback). */
  private void openSignin(String url, Runnable askCode) {
    String redirect = "";
    try { redirect = String.valueOf(android.net.Uri.parse(url).getQueryParameter("redirect_uri")); } catch (Exception e) { /* none */ }
    boolean local = redirect.startsWith("http://localhost") || redirect.startsWith("http://127.0.0.1");
    boolean opened = MainActivity.cliSigninOpen(url);
    post("native: login: sign-in address found (" + url.length() + " chars, not logged), callback "
        + (local ? "on the tablet's loopback" : "a claude.ai code page") + "; Browser app " + (opened ? "opened it" : "REFUSED it"));
    toPage("{\"step\":\"open\",\"code\":" + !local + ",\"left\":" + left() + "}");
    if (!local) askCode.run();
  }

  /** Terminal colour and cursor codes out. */
  private static String strip(String s) {
    return s.replaceAll("\u001B\\[[0-?]*[ -/]*[@-~]|\u001B\\][^\u0007\u001B]*(\u0007|\u001B\\\\)", "").trim();
  }

  /** Addresses and long tokens masked, for the hub log. */
  private static String redact(String s) {
    return s.replaceAll("https?://\\S+", "<address>").replaceAll("[A-Za-z0-9_#\\-]{24,}", "<redacted>");
  }

  private static List<String> concat(List<String> base, String... more) {
    List<String> l = new ArrayList<>(base);
    l.addAll(List.of(more));
    return l;
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
    exec(what, cmd, env, timeoutSec, closeStdin, l -> (l.contains("http") ? "[URL LINE] " : "") + l);
  }

  /** As above; show maps each output line to the text posted (null: the line is not posted). */
  private void exec(String what, List<String> cmd, Map<String, String> env, int timeoutSec, boolean closeStdin,
                    java.util.function.UnaryOperator<String> show) {
    exec(what, cmd, env, timeoutSec, closeStdin, show, String.join(" ", cmd));
  }

  /** As above; shownCmd is the command as logged (e.g. with the prompt shortened). */
  private void exec(String what, List<String> cmd, Map<String, String> env, int timeoutSec, boolean closeStdin,
                    java.util.function.UnaryOperator<String> show, String shownCmd) {
    post("native: " + what + ": exec " + shownCmd + (env.isEmpty() ? "" : ", env " + env));
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
      Thread out = pipe(p.getInputStream(), what + " stdout", show);
      Thread err = pipe(p.getErrorStream(), what + " stderr", show);
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

  private Thread pipe(InputStream in, String label, java.util.function.UnaryOperator<String> show) {
    Thread t = new Thread(() -> {
      try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
        String line;
        while ((line = r.readLine()) != null) {
          String s = show.apply(line);
          if (s != null) post("native: " + label + ": " + s);
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
