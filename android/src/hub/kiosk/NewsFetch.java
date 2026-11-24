package hub.kiosk;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Reads one News feed for the Hub page (Bridge.newsFetch). The feeds send no CORS header, so the page cannot read them.
 * Only the HOSTS below, over https on the default port. A redirect is followed only to the same host.
 * The read runs on its own thread, with a time limit and a size cap. Returns JSON: {status, body} or {error}.
 */
final class NewsFetch {
  /** The only hosts the page may read: the feeds in web/feeds.ts. Add a host only with the owner's approval. */
  static final Set<String> HOSTS = new HashSet<>(Arrays.asList("feeds.bbci.co.uk", "feeds.npr.org"));
  static final int TIMEOUT_MS = 8000;
  static final int MAX_BYTES = 1024 * 1024;
  // Names the app only. It does not name the owner.
  static final String USER_AGENT = "ClaudeOS-news";

  private NewsFetch() {}

  static String fetch(String url) {
    URL u;
    try {
      u = new URL(url);
    } catch (MalformedURLException e) {
      return err("bad url");
    }
    String why = refusal(u);
    if (why != null) return err(why);
    FutureTask<String> task = new FutureTask<>(() -> download(u));
    Thread worker = new Thread(task, "news-fetch");
    worker.setDaemon(true);
    worker.start();
    try {
      return task.get(TIMEOUT_MS, TimeUnit.MILLISECONDS);
    } catch (TimeoutException e) {
      task.cancel(true);
      return err("timed out");
    } catch (ExecutionException e) {
      Throwable c = e.getCause() != null ? e.getCause() : e;
      return err(c.getMessage() != null ? c.getMessage() : c.getClass().getSimpleName());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return err("interrupted");
    }
  }

  /** Null when the URL may be read, else the reason it may not. */
  static String refusal(URL u) {
    if (!"https".equalsIgnoreCase(u.getProtocol())) return "only https feeds are read";
    if (u.getPort() != -1 && u.getPort() != 443) return "port not allowed";
    if (!HOSTS.contains(u.getHost().toLowerCase(Locale.ROOT))) return "host not allowed";
    return null;
  }

  private static String download(URL start) throws IOException {
    URL url = start;
    for (int hop = 0; hop < 3; hop++) {
      HttpURLConnection c = (HttpURLConnection) url.openConnection();
      try {
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(TIMEOUT_MS);
        c.setReadTimeout(TIMEOUT_MS);
        c.setRequestProperty("User-Agent", USER_AGENT);
        c.setRequestProperty("Accept", "application/rss+xml, application/atom+xml, application/xml;q=0.9");
        int code = c.getResponseCode();
        if (code >= 300 && code < 400) {
          String location = c.getHeaderField("Location");
          if (location == null) return err("HTTP " + code);
          URL next = new URL(url, location);
          if (!next.getHost().equalsIgnoreCase(url.getHost())) return err("redirect to another host refused");
          String why = refusal(next);
          if (why != null) return err(why);
          url = next;
          continue;
        }
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = in == null ? "" : readCapped(in);
        return "{\"status\":" + code + ",\"body\":" + JSONObject.quote(body) + "}";
      } finally {
        c.disconnect();
      }
    }
    return err("too many redirects");
  }

  /** The stream as UTF-8 text. Throws when it is larger than MAX_BYTES. */
  private static String readCapped(InputStream in) throws IOException {
    try (InputStream src = in) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      for (int n; (n = src.read(buf)) != -1; ) {
        if (out.size() + n > MAX_BYTES) throw new IOException("feed is larger than 1 MB");
        out.write(buf, 0, n);
      }
      return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
  }

  private static String err(String msg) { return "{\"error\":" + JSONObject.quote(msg) + "}"; }
}
