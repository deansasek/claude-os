package hub.kiosk;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * The web page the build put in the APK under assets/page/ (see android/toolchain.ts).
 *
 * MainActivity calls serve() for each GET or HEAD to the Hub origin when the bundle is in use (pageSource bundle, or auto
 * while the PC is down).
 * Only the files listed in page/manifest.json are served. A listed file comes from the APK. Any other
 * path is a 404. /api/ and /apk/ are not page files: serve() returns null, so the PC answers them.
 *
 * The pageSource setting: pc (default), auto or bundle. bundle always serves the bundle; auto serves it while the PC is down.
 */
final class PageAssets {
  static final String SOURCE_PC = "pc";
  static final String SOURCE_AUTO = "auto";
  static final String SOURCE_BUNDLE = "bundle";
  /** The source used when the setting is unset or unknown. */
  static final String DEFAULT_SOURCE = SOURCE_PC;

  /** Reads the pageSource value: "auto" and "bundle" in any case; anything else is the default, pc. */
  static String sourceOf(String raw) {
    String v = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
    if (SOURCE_AUTO.equals(v) || SOURCE_BUNDLE.equals(v)) return v;
    return DEFAULT_SOURCE;
  }

  private static final String TAG = "HubKiosk";
  private static final String ROOT = "page";
  private final AssetManager assets;
  private Set<String> files;   // the paths in page/manifest.json, read on first use; empty when the APK has no bundle

  PageAssets(Context context) {
    assets = context.getAssets();
  }

  /** The response for a GET of path on the Hub origin, or null when the PC should answer it. */
  WebResourceResponse serve(String path) {
    String p = path == null || path.isEmpty() || "/".equals(path) ? "/index.html" : path;
    if (p.startsWith("/api/") || p.startsWith("/apk/")) return null;
    if (p.contains("..") || !files().contains(p)) return notFound();
    try {
      return new WebResourceResponse(mimeOf(p), "utf-8", assets.open(ROOT + p));
    } catch (IOException e) {
      Log.w(TAG, "page file missing from the APK: " + p);
      return notFound();
    }
  }

  /** True when the APK holds a page bundle: the manifest lists at least one file. */
  boolean hasBundle() {
    return !files().isEmpty();
  }

  private synchronized Set<String> files() {
    if (files != null) return files;
    Set<String> set = new HashSet<>();
    try (InputStream in = assets.open(ROOT + "/manifest.json")) {
      JSONArray list = new JSONObject(readAll(in)).getJSONArray("files");
      for (int i = 0; i < list.length(); i++) set.add(list.getJSONObject(i).getString("path"));
    } catch (Exception e) {
      Log.w(TAG, "no page bundle in the APK: " + e.getMessage());
    }
    files = set;
    return files;
  }

  private static String readAll(InputStream in) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
    return out.toString("UTF-8");
  }

  private static WebResourceResponse notFound() {
    return new WebResourceResponse("text/plain", "utf-8", 404, "Not found",
        Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
  }

  /** The media type for a page file, by extension. Same types as the PC server (src/core/server/index.ts). */
  static String mimeOf(String path) {
    int dot = path.lastIndexOf('.');
    String ext = dot < 0 ? "" : path.substring(dot).toLowerCase(Locale.ROOT);
    switch (ext) {
      case ".html": return "text/html";
      case ".css": return "text/css";
      case ".js":
      case ".ts": return "text/javascript";
      case ".json": return "application/json";
      case ".svg": return "image/svg+xml";
      case ".png": return "image/png";
      case ".ico": return "image/x-icon";
      default: return "application/octet-stream";
    }
  }
}
