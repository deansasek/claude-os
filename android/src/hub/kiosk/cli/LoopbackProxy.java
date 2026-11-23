package hub.kiosk.cli;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * A small HTTP proxy on 127.0.0.1 for the tablet's Claude CLI (ClaudeCli). The CLI's musl libc has no DNS
 * config on Android (no /etc/resolv.conf), so it cannot resolve names. The CLI sends its requests here (HTTPS_PROXY,
 * HTTP_PROXY); this proxy resolves each host with InetAddress (Android's resolver) and pipes the bytes.
 *
 * CONNECT host:port: opens the socket, answers 200, then pipes both ways (TLS stays end to end; this proxy sees only
 * encrypted bytes). A plain HTTP request with an absolute address: forwarded with the request line in origin form.
 * Logs the host of each request (never the path, headers or contents).
 */
final class LoopbackProxy implements Closeable {
  private static final int HEAD_MAX = 16 * 1024;
  private static final int CONNECT_TIMEOUT_MS = 15_000;

  private final ServerSocket server;
  private final ExecutorService pool = new ThreadPoolExecutor(0, 64, 30, TimeUnit.SECONDS, new SynchronousQueue<>());
  private final Consumer<String> log;

  private LoopbackProxy(Consumer<String> log) throws IOException {
    this.log = log;
    server = new ServerSocket();
    server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 50);   // loopback only, a free port
    Thread t = new Thread(this::acceptLoop, "proxy-accept");
    t.setDaemon(true);
    t.start();
  }

  /** Starts the proxy on a free loopback port. */
  static LoopbackProxy start(Consumer<String> log) throws IOException {
    return new LoopbackProxy(log);
  }

  int port() { return server.getLocalPort(); }

  /** The address for HTTPS_PROXY and HTTP_PROXY. */
  String url() { return "http://127.0.0.1:" + port(); }

  @Override public void close() {
    try { server.close(); } catch (IOException e) { /* already closed */ }
    pool.shutdownNow();
  }

  private void acceptLoop() {
    while (!server.isClosed()) {
      Socket client;
      try { client = server.accept(); } catch (IOException e) { return; }   // closed
      try {
        pool.execute(() -> serve(client));
      } catch (Exception e) {   // pool full or shut down
        quiet(client);
      }
    }
  }

  private void serve(Socket client) {
    Socket upstream = null;
    try {
      client.setSoTimeout(60_000);
      InputStream in = client.getInputStream();
      byte[] head = readHead(in);
      if (head == null) { quiet(client); return; }
      String text = new String(head, StandardCharsets.ISO_8859_1);
      int eol = text.indexOf("\r\n");
      String[] first = text.substring(0, eol).split(" ");
      if (first.length < 3) { reply(client, "400 Bad Request"); return; }
      String method = first[0];
      String host;
      int port;
      byte[] forward = null;   // the request bytes to send upstream (plain HTTP only)
      if (method.equalsIgnoreCase("CONNECT")) {
        int colon = first[1].lastIndexOf(':');
        host = strip(colon > 0 ? first[1].substring(0, colon) : first[1]);
        port = colon > 0 ? Integer.parseInt(first[1].substring(colon + 1)) : 443;
      } else {
        URI u = URI.create(first[1]);
        if (u.getHost() == null || !"http".equalsIgnoreCase(u.getScheme())) { reply(client, "400 Bad Request"); return; }
        host = strip(u.getHost());
        port = u.getPort() > 0 ? u.getPort() : 80;
        String path = (u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath())
            + (u.getRawQuery() == null ? "" : "?" + u.getRawQuery());
        String line = method + " " + path + " " + first[2];
        forward = (line + text.substring(eol)).getBytes(StandardCharsets.ISO_8859_1);
      }
      log.accept("proxy: " + (forward == null ? "CONNECT " : method + " ") + host + ":" + port);
      InetAddress addr;
      try {
        addr = InetAddress.getByName(host);   // Android's resolver
      } catch (IOException e) {
        log.accept("proxy: cannot resolve " + host);
        reply(client, "502 Bad Gateway");
        return;
      }
      upstream = new Socket();
      try {
        upstream.connect(new InetSocketAddress(addr, port), CONNECT_TIMEOUT_MS);
      } catch (IOException e) {
        log.accept("proxy: cannot reach " + host + ":" + port + " (" + e.getClass().getSimpleName() + ")");
        reply(client, "502 Bad Gateway");
        quiet(upstream);
        return;
      }
      client.setSoTimeout(0);
      OutputStream up = upstream.getOutputStream();
      if (forward == null) {
        client.getOutputStream().write("HTTP/1.1 200 Connection Established\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
        client.getOutputStream().flush();
      } else {
        up.write(forward);
        up.flush();
      }
      Socket u = upstream;
      pool.execute(() -> pipe(u, client));   // upstream to the CLI
      pipe(client, upstream);                // the CLI to upstream
    } catch (Exception e) {
      quiet(client);
      if (upstream != null) quiet(upstream);
    }
  }

  /** Reads up to the end of the request head (\r\n\r\n). Only the head: the CONNECT body is the tunnel itself. */
  private static byte[] readHead(InputStream in) throws IOException {
    ByteArrayOutputStream b = new ByteArrayOutputStream(512);
    int state = 0;
    while (b.size() < HEAD_MAX) {
      int c = in.read();
      if (c < 0) return null;
      b.write(c);
      state = (c == '\r' && (state == 0 || state == 2)) ? state + 1
          : (c == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
      if (state == 4) return b.toByteArray();
    }
    return null;
  }

  /** Copies from a to b until either side ends, then closes both. */
  private static void pipe(Socket a, Socket b) {
    byte[] buf = new byte[32 * 1024];
    try {
      InputStream in = a.getInputStream();
      OutputStream out = b.getOutputStream();
      int n;
      while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); out.flush(); }
    } catch (IOException e) {
      // one side closed
    } finally {
      quiet(a);
      quiet(b);
    }
  }

  private static void reply(Socket s, String status) {
    try {
      s.getOutputStream().write(("HTTP/1.1 " + status + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
          .getBytes(StandardCharsets.ISO_8859_1));
    } catch (IOException e) { /* gone */ }
    quiet(s);
  }

  /** [::1] to ::1. */
  private static String strip(String host) {
    return host.startsWith("[") && host.endsWith("]") ? host.substring(1, host.length() - 1) : host;
  }

  private static void quiet(Closeable c) {
    try { c.close(); } catch (IOException e) { /* ignore */ }
  }
}
