package hub.kiosk.cli;

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
 * Claude chats on the tablet's own Claude Code CLI (apps/claude/web/native.ts).
 *
 * The APK bundles Alpine's musl dynamic loader (ld-musl-aarch64.so.1, musl 1.2.6-r3) as lib/arm64-v8a/libmuslld.so,
 * so the installer extracts it to nativeLibraryDir, where the app may execute files. On first use the CLI downloads
 * the latest @anthropic-ai/claude-code-linux-arm64-musl from the npm registry into files/claude/ (about 365 MB,
 * checked against the registry's sha512 integrity), then runs it as:
 *   libmuslld.so --library-path nativeLibraryDir files/claude/claude ...
 * The binary itself is not changed. musl has no DNS config on Android (no /etc/resolv.conf), so the CLI's requests go
 * through LoopbackProxy (HTTPS_PROXY, HTTP_PROXY), which resolves each host with Android's resolver.
 *
 * Sign-in (Bridge.cliSigninStart): the official `claude auth login`; see login(). The CLI, not ClaudeOS, exchanges
 * the code for the token and stores it itself. ClaudeOS never reads files/claude/, ~/.claude or the CLI's credentials
 * file, never stores the token or the code, and never logs the code, a prompt, a reply or a session id.
 */
public final class ClaudeCli {
  private static final String TAG = "ClaudeCli";
  private static final String META = "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-arm64-musl/latest";
  private static final String LOADER = "libmuslld.so";

  private ClaudeCli() {}

  private static void log(String line) { Log.i(TAG, line); }

  // ---------- the CLI binary and how it runs ----------

  /** The CLI is installed when its binary and version.txt are here. A chat send checks this first, so no download starts on the chat thread. */
  private static boolean installed(Context app) {
    File dir = new File(app.getFilesDir(), "claude");
    return new File(dir, "claude").exists() && new File(dir, "version.txt").exists();
  }

  /** Thrown when a chat is sent before the CLI is installed: the page then says to sign in under Settings. */
  private static final class NotInstalled extends Exception {
    NotInstalled() { super("cli not installed"); }
  }

  /** The loader and the binary as a command (downloads the binary on first use). Throws when the binary is missing. */
  private static List<String> base(Context app) throws Exception {
    String libDir = app.getApplicationInfo().nativeLibraryDir;
    File dir = new File(app.getFilesDir(), "claude");
    File bin = new File(dir, "claude");
    if (!bin.exists() || !new File(dir, "version.txt").exists()) bin = download(dir);
    if (bin == null) throw new IllegalStateException("no CLI binary");
    bin.setExecutable(true, true);
    return List.of(new File(libDir, LOADER).getAbsolutePath(), "--library-path", libDir, bin.getAbsolutePath());
  }

  /** A process builder with HOME and TMPDIR in the app's files folder and the proxy env. */
  private static ProcessBuilder builder(Context app, List<String> cmd, LoopbackProxy proxy) {
    File home = app.getFilesDir();
    File tmp = new File(home, "tmp");
    tmp.mkdirs();
    ProcessBuilder pb = new ProcessBuilder(cmd).directory(home);
    pb.environment().put("HOME", home.getAbsolutePath());
    pb.environment().put("TMPDIR", tmp.getAbsolutePath());
    // BROWSER=echo stops the CLI from trying to open a browser on Android
    pb.environment().putAll(Map.of("DISABLE_AUTOUPDATER", "1", "BROWSER", "echo",
        "HTTPS_PROXY", proxy.url(), "HTTP_PROXY", proxy.url(), "NO_PROXY", "localhost,127.0.0.1"));
    return pb;
  }

  // ---------- sign-in ----------
  // The flow: the CLI prints its sign-in address; the runner hands it to the page, which opens it in ClaudeOS's own
  // Browser app. The user signs in on claude.ai. While the CLI takes a code, the Browser's bar shows "Enter sign-in
  // code" with the time left; only a tap opens the ClaudeOS sheet (core/web/cli-signin.ts). Its Paste reads the
  // clipboard (Bridge.cliSigninClipboard), its Send sends the code (Bridge.cliSigninCode), and sendCode() writes it plus
  // a newline to the CLI's stdin, then closes stdin. Then `claude auth status` says whether the CLI is signed in.

  private static final long LOGIN_MAX_SEC = 600;   // the CLI waits at most 10 minutes for the user
  private static final String AUTHORIZE = "https://claude.ai/oauth/authorize";
  private static final java.util.regex.Pattern PROMPT = java.util.regex.Pattern.compile("(?i)paste.{0,20}code|code.{0,20}here");
  private static final java.util.regex.Pattern LOGGED_IN = java.util.regex.Pattern.compile("\"loggedIn\"\\s*:\\s*true");
  /** The waiting CLI's stdin while it may take a code; null otherwise. */
  private static volatile OutputStream loginIn;
  /** When the runner stops the waiting login (System.currentTimeMillis()); 0 when no login runs. */
  private static volatile long loginDeadline;
  private static boolean signingIn;   // a sign-in (download, login, status) runs; guarded by ClaudeCli.class
  /** The last `claude auth status`: 1 signed in, 0 not, -1 not checked yet. */
  private static volatile int signedIn = -1;

  /**
   * Bridge.cliSigninStart: downloads the CLI if needed, then runs `claude auth login` and `claude auth status` on a
   * background thread. The page gets each step (toPage). Returns false when a sign-in already runs.
   */
  public static boolean startSignin(Context c) {
    synchronized (ClaudeCli.class) {
      if (signingIn) return false;
      signingIn = true;
    }
    Context app = c.getApplicationContext();
    new Thread(() -> {
      boolean ok = false;
      try (LoopbackProxy proxy = LoopbackProxy.start(ClaudeCli::log)) {
        toPage("{\"step\":\"prepare\"}");
        List<String> base = base(app);
        login(app, base, proxy);
        ok = status(app, base, proxy);
      } catch (Throwable t) {
        log("signin: failed: " + t.getClass().getSimpleName());
      } finally {
        synchronized (ClaudeCli.class) { signingIn = false; }
        toPage("{\"step\":\"done\",\"ok\":" + ok + "}");
      }
    }, "claude-signin").start();
    return true;
  }

  /**
   * Bridge.cliAuthState: {"signedIn":1|0|-1,"busy":bool}. -1: not checked yet. With check (and no sign-in running and
   * the CLI already downloaded), runs `claude auth status` in the background; the page gets {"step":"status"} after it.
   */
  public static String authState(Context c, boolean check) {
    boolean busy;
    synchronized (ClaudeCli.class) { busy = signingIn; }
    File bin = new File(new File(c.getFilesDir(), "claude"), "claude");
    if (!bin.exists()) signedIn = 0;
    else if (check && !busy) {
      Context app = c.getApplicationContext();
      new Thread(() -> {
        try (LoopbackProxy proxy = LoopbackProxy.start(ClaudeCli::log)) {
          status(app, base(app), proxy);
        } catch (Throwable t) {
          log("status: failed: " + t.getClass().getSimpleName());
        }
        toPage("{\"step\":\"status\",\"signedIn\":" + signedIn + "}");
      }, "claude-status").start();
    }
    return "{\"signedIn\":" + signedIn + ",\"busy\":" + busy + "}";
  }

  /** `claude auth status`: true when it reports loggedIn. Reads only that field; nothing of the output is logged. */
  private static boolean status(Context app, List<String> base, LoopbackProxy proxy) throws Exception {
    Process p = builder(app, concat(base, "auth", "status"), proxy).redirectErrorStream(true).start();
    p.getOutputStream().close();
    String out;
    try (InputStream in = p.getInputStream()) { out = new String(in.readAllBytes(), StandardCharsets.UTF_8); }
    if (!p.waitFor(60, TimeUnit.SECONDS)) p.destroyForcibly();
    boolean ok = LOGGED_IN.matcher(out).find();
    signedIn = ok ? 1 : 0;
    log("status: signed in " + ok);
    return ok;
  }

  /** Seconds left for the running login, or -1 when no login takes a code (Bridge.cliSigninState). */
  public static long secondsLeft() {
    long d = loginDeadline;
    if (loginIn == null || d == 0) return -1;
    return Math.max(0, (d - System.currentTimeMillis()) / 1000);
  }

  /** The clipboard's text, or "" (never logged). */
  private static String clipboard(Context c) {
    try {
      android.content.ClipboardManager cm = c.getSystemService(android.content.ClipboardManager.class);
      android.content.ClipData clip = cm == null ? null : cm.getPrimaryClip();
      if (clip != null && clip.getItemCount() > 0) return String.valueOf(clip.getItemAt(0).coerceToText(c)).trim();
    } catch (Exception e) { /* no clipboard */ }
    return "";
  }

  /**
   * The sheet's Paste (Bridge.cliSigninClipboard): the clipboard's text, read natively because the WebView's own
   * clipboard read is blocked. Only while a login takes a code, so the page gets no general clipboard read. Puts the
   * text in out and returns null, else returns a short reason. Never logs the text.
   */
  public static String clipboardCode(Context c, StringBuilder out) {
    if (loginIn == null) return "no sign-in is waiting";
    String text = clipboard(c);
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
    synchronized (ClaudeCli.class) { in = loginIn; loginIn = null; }
    if (in == null) return "no sign-in is waiting";
    String text = code == null ? "" : code.trim();
    if (text.isEmpty()) text = clipboard(c);
    if (text.isEmpty() || text.length() > 2048 || text.contains("\n")) {
      synchronized (ClaudeCli.class) { if (loginIn == null) loginIn = in; }   // still waiting: try again
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
   * The page's step (core/web/cli-signin.ts): {"step":"prepare"} | {"step":"open","code":bool,"left":s} |
   * {"step":"code","left":s} | {"step":"done","ok":bool} | {"step":"status","signedIn":n}. left: seconds until the
   * runner stops the login. The page never opens the code sheet by itself.
   */
  private static void toPage(String json) {
    try { MainActivity.cliSignin(json); } catch (Throwable t) { Log.e(TAG, "page step failed"); }
  }

  private static long left() { return Math.max(0, (loginDeadline - System.currentTimeMillis()) / 1000); }

  private static void login(Context app, List<String> base, LoopbackProxy proxy) {
    log("login: start");
    android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
    boolean[] codeAsked = { false };
    Runnable askCode = () -> {
      synchronized (codeAsked) { if (codeAsked[0]) return; codeAsked[0] = true; }
      log("login: the CLI takes a code now");
      toPage("{\"step\":\"code\",\"left\":" + left() + "}");
    };
    Process p = null;
    try {
      long t0 = System.currentTimeMillis();
      loginDeadline = t0 + LOGIN_MAX_SEC * 1000;
      p = builder(app, concat(base, "auth", "login"), proxy).start();
      loginIn = p.getOutputStream();   // stdin stays open: the CLI may wait for a pasted code
      Thread out = loginReader(p.getInputStream(), askCode, ui);
      Thread err = loginReader(p.getErrorStream(), askCode, ui);
      if (!p.waitFor(LOGIN_MAX_SEC, TimeUnit.SECONDS)) {
        log("login: still waiting after " + LOGIN_MAX_SEC + " s, stopping it");
        p.destroyForcibly();
        p.waitFor(5, TimeUnit.SECONDS);
      }
      out.join(2000);
      err.join(2000);
      log("login: exit code " + p.exitValue() + " after " + (System.currentTimeMillis() - t0) / 1000 + " s");
    } catch (Throwable t) {
      log("login: failed: " + t.getClass().getSimpleName());
      if (p != null) p.destroyForcibly();
    } finally {
      loginIn = null;
      loginDeadline = 0;
    }
  }

  /**
   * Reads the CLI's output by characters (a prompt has no newline): finds the sign-in address (it may wrap onto
   * following lines), sends it to the page once, and calls askCode when the CLI asks for a code. Logs nothing of it.
   */
  private static Thread loginReader(InputStream in, Runnable askCode, android.os.Handler ui) {
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
          }
          if (PROMPT.matcher(strip(line.toString())).find()) { ui.post(open); askCode.run(); }   // a prompt with no newline
        }
      } catch (Exception e) { /* ended */ }
    }, "claude-login-out");
    t.start();
    return t;
  }

  /** The sign-in address to ClaudeOS's Browser. code: claude.ai shows a code to copy (no localhost callback). */
  private static void openSignin(String url, Runnable askCode) {
    String redirect = "";
    try { redirect = String.valueOf(android.net.Uri.parse(url).getQueryParameter("redirect_uri")); } catch (Exception e) { /* none */ }
    boolean local = redirect.startsWith("http://localhost") || redirect.startsWith("http://127.0.0.1");
    boolean opened = MainActivity.cliSigninOpen(url);
    log("login: sign-in address found, Browser " + (opened ? "opened it" : "refused it"));
    toPage("{\"step\":\"open\",\"code\":" + !local + ",\"left\":" + left() + "}");
    if (!local) askCode.run();
  }

  // ---------- chat (Bridge.claudeSend / claudeStop) ----------
  // One long-lived `claude -p` in stream-json mode per chat, through the loader and LoopbackProxy. Each user message is
  // one stream-json line on its stdin; each stdout line goes to the page as a string (window.hubClaudeNative), which
  // parses it (native-stream.ts). No tools (--tools=), no permission prompts (dontAsk). A new chat (no session id),
  // another session's id or another model starts a new process; a known id with no process resumes it.
  // Logs carry event types and lengths only.

  private static final ExecutorService chatQueue = Executors.newSingleThreadExecutor(r -> new Thread(r, "claude-chat"));
  private static final java.util.regex.Pattern TYPE = java.util.regex.Pattern.compile("\"type\":\"([a-z_]+)\"");
  private static final java.util.regex.Pattern SESSION = java.util.regex.Pattern.compile("\"session_id\":\"([^\"]+)\"");
  private static Process chat;            // the running chat process; null when none
  private static OutputStream chatIn;
  private static String chatSession;      // its session id (from system/init)
  private static String chatModel;        // its model: haiku, sonnet or opus
  private static Process stopWaiting;     // a chat sent an interrupt: its result ends the wait, else the process is destroyed after 5 s

  // ---------- ending an idle chat ----------
  // A chat process ends after CHAT_IDLE_MS with no send, no output and no reply running. The next send resumes the saved
  // session (startChat passes --resume). 10 min is the default; the idle time is a pending decision. Logs carry no text.
  static final long CHAT_IDLE_MS = 10 * 60 * 1000L;
  private static final java.util.concurrent.ScheduledExecutorService idleTimer = java.util.concurrent.Executors
      .newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "claude-chat-idle"); t.setDaemon(true); return t; });
  private static long chatActiveAt;       // the last send or output line of the chat process (ms)
  private static boolean chatReplying;    // a reply runs: its result ends it

  /** Checks chat process p after delayMs. Guarded by ClaudeCli.class where the check reads the chat. */
  private static void scheduleIdleEnd(Process p, long delayMs) {
    idleTimer.schedule(() -> endIdleChat(p), delayMs, TimeUnit.MILLISECONDS);
  }

  /** Ends p when it is still the chat, no reply runs, and it had no send or output for CHAT_IDLE_MS; else checks again. */
  private static void endIdleChat(Process p) {
    synchronized (ClaudeCli.class) {
      if (chat != p) return;   // ended or replaced already
      if (chatReplying) { scheduleIdleEnd(p, CHAT_IDLE_MS); return; }
      long quiet = System.currentTimeMillis() - chatActiveAt;
      if (quiet < CHAT_IDLE_MS) { scheduleIdleEnd(p, CHAT_IDLE_MS - quiet); return; }
      log("chat: idle, ending the process");
      p.destroy();   // its exit stays quiet: chat is cleared here
      chat = null;
      chatIn = null;
    }
  }

  /** Bridge.claudeSend: one user message, queued on the chat thread. sessionId '' or null: a new chat. */
  public static void turn(Context c, String prompt, String sessionId, String model) {
    Context app = c.getApplicationContext();
    chatQueue.execute(() -> {
      try {
        sendTurn(app, prompt, sessionId == null ? "" : sessionId, model);
      } catch (Throwable t) {
        Log.e(TAG, "chat: send failed: " + t.getClass().getSimpleName());
        chatEvent("{\"type\":\"error\",\"message\":\"" + (t instanceof NotInstalled ? "not_signed_in" : "start_failed") + "\"}");
      }
    });
  }

  /** Bridge.claudeStop: asks the running reply to stop with an interrupt control request on stdin. When no result
   *  comes within 5 s, the process is destroyed. The next send resumes the session (the page gets an exit event then). */
  public static void stopChat() {
    Process p;
    OutputStream in;
    synchronized (ClaudeCli.class) { p = chat; in = chatIn; }
    if (p == null) return;
    log("chat: stop, interrupt");
    try {
      String req = new org.json.JSONObject().put("type", "control_request").put("request_id", "claudeos-interrupt")
          .put("request", new org.json.JSONObject().put("subtype", "interrupt")).toString();
      synchronized (ClaudeCli.class) { stopWaiting = p; }
      in.write((req + "\n").getBytes(StandardCharsets.UTF_8));
      in.flush();
    } catch (Exception e) {
      log("chat: interrupt not sent, destroy");
      synchronized (ClaudeCli.class) { stopWaiting = null; }
      p.destroy();
      return;
    }
    new Thread(() -> {
      try { Thread.sleep(5000); } catch (InterruptedException e) { return; }
      synchronized (ClaudeCli.class) { if (stopWaiting != p) return; stopWaiting = null; }
      log("chat: no result after interrupt, destroy");
      p.destroy();
    }, "claude-chat-stop").start();
  }

  private static void sendTurn(Context app, String prompt, String sessionId, String model) throws Exception {
    OutputStream in;
    synchronized (ClaudeCli.class) {
      boolean same = chat != null && chat.isAlive() && !sessionId.isEmpty() && sessionId.equals(chatSession) && model.equals(chatModel);
      if (!same && chat != null) { chat.destroy(); chat = null; chatIn = null; }   // replaced: its exit stays quiet
      in = same ? chatIn : null;
    }
    if (in == null) {
      if (!installed(app)) throw new NotInstalled();   // no download on the chat thread: the page says to sign in
      in = startChat(app, sessionId, model);
    }
    String line = new org.json.JSONObject().put("type", "user")
        .put("message", new org.json.JSONObject().put("role", "user").put("content", prompt)).toString();
    log("chat: user message, " + prompt.length() + " chars");
    synchronized (ClaudeCli.class) {   // the reply runs: no idle end until its result
      chatReplying = true;
      chatActiveAt = System.currentTimeMillis();
      if (chat != null) scheduleIdleEnd(chat, CHAT_IDLE_MS);
    }
    try {
      in.write((line + "\n").getBytes(StandardCharsets.UTF_8));
      in.flush();
    } catch (Exception e) {
      synchronized (ClaudeCli.class) { chatReplying = false; }
      throw e;
    }
  }

  private static OutputStream startChat(Context app, String resume, String model) throws Exception {
    List<String> cmd = concat(base(app), "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--include-partial-messages", "--permission-mode", "dontAsk", "--model", model, "--tools=");
    if (!resume.isEmpty()) cmd = concat(cmd, "--resume", resume);
    LoopbackProxy proxy = LoopbackProxy.start(ClaudeCli::log);
    Process p;
    try { p = builder(app, cmd, proxy).start(); } catch (Exception e) { proxy.close(); throw e; }
    log("chat: process started, " + model + ", " + (resume.isEmpty() ? "new session" : "resume"));
    synchronized (ClaudeCli.class) { chat = p; chatIn = p.getOutputStream(); chatSession = resume.isEmpty() ? null : resume; chatModel = model; }
    new Thread(() -> {
      try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getErrorStream(), StandardCharsets.UTF_8))) {
        String l;
        while ((l = r.readLine()) != null) log("chat: stderr line, " + l.length() + " chars");
      } catch (Exception e) { /* ended */ }
    }, "claude-chat-err").start();
    new Thread(() -> {
      try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
        String l;
        while ((l = r.readLine()) != null) {
          java.util.regex.Matcher t = TYPE.matcher(l);
          String type = t.find() ? t.group(1) : "?";
          if (!"stream_event".equals(type)) log("chat: event " + type + ", " + l.length() + " chars");
          synchronized (ClaudeCli.class) {
            if (chat != p) continue;   // replaced by a newer chat
            chatActiveAt = System.currentTimeMillis();
            if ("result".equals(type)) { chatReplying = false; scheduleIdleEnd(p, CHAT_IDLE_MS); }
            if ("system".equals(type)) { java.util.regex.Matcher s = SESSION.matcher(l); if (s.find()) chatSession = s.group(1); }
            if ("result".equals(type) && stopWaiting == p) stopWaiting = null;   // the interrupted reply ended
          }
          chatEvent(l);
        }
      } catch (Exception e) { /* ended */ }
      int code = -1;
      try { p.waitFor(5, TimeUnit.SECONDS); code = p.exitValue(); } catch (Exception e) { p.destroyForcibly(); }
      proxy.close();
      boolean current;
      synchronized (ClaudeCli.class) { current = chat == p; if (current) { chat = null; chatIn = null; } }
      log("chat: process exited, code " + code + (current ? "" : " (replaced)"));
      if (current) chatEvent("{\"type\":\"exit\",\"code\":" + code + "}");
    }, "claude-chat-out").start();
    return p.getOutputStream();
  }

  // ---------- the usage check (Bridge.claudeUsageCheck, Settings → Usage) ----------
  // The CLI answers the stream-json control request get_usage with the plan's windows (rate_limits: five_hour,
  // seven_day, seven_day_opus, seven_day_sonnet, model_scoped). The check sends no user message, so the CLI makes no
  // model request and spends no usage: it reads the windows from its plan-usage endpoint (GET /api/oauth/usage, the same
  // read as its /usage command), or from its own saved copy (up to an hour old) when that endpoint does not answer.
  // rate_limits is null when neither has the windows. The get_usage reply goes to the page as a chat line
  // (native-stream.ts reads it); a {"type":"usage_check","ok":bool} line ends the check. The CLI reads the limits with
  // its own sign-in: ClaudeOS reads no token. Logs carry event types only.

  private static final long USAGE_MAX_SEC = 60;
  private static final String USAGE_REQUEST = "claudeos-usage";   // native-stream.ts USAGE_REQUEST
  private static boolean checkingUsage;   // guarded by ClaudeCli.class

  /** Starts a usage check on a background thread; false when one already runs. */
  public static boolean usageCheck(Context c) {
    synchronized (ClaudeCli.class) {
      if (checkingUsage) return false;
      checkingUsage = true;
    }
    Context app = c.getApplicationContext();
    new Thread(() -> {
      boolean ok = false;
      try (LoopbackProxy proxy = LoopbackProxy.start(ClaudeCli::log)) {
        ok = runUsageCheck(app, proxy);
      } catch (Throwable t) {
        log("usage: failed: " + t.getClass().getSimpleName());
      } finally {
        synchronized (ClaudeCli.class) { checkingUsage = false; }
        chatEvent("{\"type\":\"usage_check\",\"ok\":" + ok + "}");
      }
    }, "claude-usage").start();
    return true;
  }

  private static boolean runUsageCheck(Context app, LoopbackProxy proxy) throws Exception {
    List<String> cmd = concat(base(app), "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "dontAsk", "--tools=", "--strict-mcp-config", "--no-session-persistence");
    Process p = builder(app, cmd, proxy).start();
    log("usage: process started");
    new Thread(() -> {   // stderr is read and dropped, so the CLI never blocks on it
      byte[] buf = new byte[8192];
      try (InputStream err = p.getErrorStream()) { while (err.read(buf) >= 0) { /* dropped */ } } catch (Exception e) { /* ended */ }
    }, "claude-usage-err").start();
    boolean ok = false;
    try {
      OutputStream in = p.getOutputStream();   // one control request and no user message: no model request
      String req = new org.json.JSONObject().put("type", "control_request").put("request_id", USAGE_REQUEST)
          .put("request", new org.json.JSONObject().put("subtype", "get_usage").put("skip_behaviors", true)).toString();
      in.write((req + "\n").getBytes(StandardCharsets.UTF_8));
      in.flush();
      long deadline = System.currentTimeMillis() + USAGE_MAX_SEC * 1000;
      Thread watchdog = new Thread(() -> {
        try { if (!p.waitFor(USAGE_MAX_SEC, TimeUnit.SECONDS)) { log("usage: no answer, stopping it"); p.destroyForcibly(); } }
        catch (InterruptedException e) { /* done */ }
      }, "claude-usage-watch");
      watchdog.start();
      try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
        String l;
        while ((l = r.readLine()) != null && System.currentTimeMillis() < deadline) {
          java.util.regex.Matcher t = TYPE.matcher(l);
          String type = t.find() ? t.group(1) : "?";
          log("usage: event " + type);
          if ("control_response".equals(type) && l.contains("\"" + USAGE_REQUEST + "\"")) {
            chatEvent(l);
            ok = l.contains("\"subtype\":\"success\"") && !l.contains("\"rate_limits\":null");
            in.close();   // the CLI ends when its input ends
            break;
          }
        }
      }
    } finally {
      if (!p.waitFor(5, TimeUnit.SECONDS)) p.destroyForcibly();
    }
    log("usage: done, answered " + ok);
    return ok;
  }

  /** One stream-json line to the page, as a JS string (the page parses it). */
  private static void chatEvent(String line) {
    try { MainActivity.claudeNative(org.json.JSONObject.quote(line)); } catch (Throwable t) { Log.e(TAG, "chat: page event failed"); }
  }

  /** Terminal colour and cursor codes out. */
  private static String strip(String s) {
    return s.replaceAll("\u001B\\[[0-?]*[ -/]*[@-~]|\u001B\\][^\u0007\u001B]*(\u0007|\u001B\\\\)", "").trim();
  }

  private static List<String> concat(List<String> base, String... more) {
    List<String> l = new ArrayList<>(base);
    l.addAll(List.of(more));
    return l;
  }

  // ---------- the download ----------

  private static final Object DOWNLOAD = new Object();   // one download at a time (not the class lock: it takes minutes)

  /** Downloads and unpacks the latest package into dir (skipped when that version is already there). One at a time. */
  private static File download(File dir) throws Exception {
    synchronized (DOWNLOAD) { return downloadLocked(dir); }
  }

  private static File downloadLocked(File dir) throws Exception {
    String meta = new String(get(META).readAllBytes(), StandardCharsets.UTF_8);
    String version = field(meta, "version");
    String tarball = field(meta, "tarball");
    String integrity = field(meta, "integrity");
    File bin = new File(dir, "claude");
    File stamp = new File(dir, "version.txt");
    if (bin.exists() && stamp.exists()
        && new String(java.nio.file.Files.readAllBytes(stamp.toPath()), StandardCharsets.UTF_8).equals(version)) {
      return bin;
    }
    log("download: " + version);
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
    boolean match = got.equals(integrity);
    log("download: took " + (System.currentTimeMillis() - t0) / 1000 + " s, integrity " + (match ? "matches" : "MISMATCH"));
    if (!found || !match) { bin.delete(); return null; }
    java.nio.file.Files.write(stamp.toPath(), version.getBytes(StandardCharsets.UTF_8));
    return bin;
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

  private static void copy(InputStream in, OutputStream out, long size) throws Exception {
    byte[] buf = new byte[256 * 1024];
    long left = size;
    while (left > 0) {
      int r = in.read(buf, 0, (int) Math.min(buf.length, left));
      if (r < 0) throw new IllegalStateException("tarball ended early");
      out.write(buf, 0, r);
      left -= r;
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
