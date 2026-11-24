package hub.kiosk;

import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.PixelCopy;
import android.view.Window;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * The power menu's Screenshot: a JPEG of ClaudeOS's own window, sent to the PC's Photos library through the existing
 * upload route (POST {server}/api/photos/upload, header X-Photo-Id). PixelCopy reads only this app's window, so
 * Android's own screens and other apps are not in the picture. Nothing is shown on the tablet.
 */
final class Screenshot {
  private Screenshot() { }

  /** {"ok": true, "id": ...} or {"ok": false, "error": ...}. Blocks for the capture and the upload (not the UI thread). */
  static String take(MainActivity act, String server, String id) {
    try {
      Window w = act.getWindow();
      Bitmap bmp = Bitmap.createBitmap(w.getDecorView().getWidth(), w.getDecorView().getHeight(), Bitmap.Config.ARGB_8888);
      CountDownLatch done = new CountDownLatch(1);
      final int[] result = {PixelCopy.ERROR_UNKNOWN};
      PixelCopy.request(w, bmp, copied -> { result[0] = copied; done.countDown(); }, new Handler(Looper.getMainLooper()));
      if (!done.await(5, TimeUnit.SECONDS) || result[0] != PixelCopy.SUCCESS) return err("capture failed");
      ByteArrayOutputStream jpg = new ByteArrayOutputStream();
      bmp.compress(Bitmap.CompressFormat.JPEG, 85, jpg);
      bmp.recycle();

      HttpURLConnection c = (HttpURLConnection) new URL(server + "/api/photos/upload").openConnection();
      c.setRequestMethod("POST");
      c.setDoOutput(true);
      c.setConnectTimeout(5000);
      c.setReadTimeout(20000);
      c.setRequestProperty("Content-Type", "image/jpeg");
      c.setRequestProperty("X-Photo-Id", id);
      try (OutputStream out = c.getOutputStream()) { out.write(jpg.toByteArray()); }
      if (c.getResponseCode() != 200) return err("upload http " + c.getResponseCode());
      JSONObject reply = new JSONObject(read(c));
      if (!reply.optBoolean("ok", false)) return err(reply.optString("error", "upload refused"));
      return "{\"ok\":true,\"id\":" + JSONObject.quote(id) + "}";
    } catch (Exception e) {
      Log.w(MainActivity.TAG, "screenshot", e);
      return err(String.valueOf(e.getMessage()));
    }
  }

  private static String read(HttpURLConnection c) throws Exception {
    try (InputStream in = c.getInputStream()) {
      ByteArrayOutputStream b = new ByteArrayOutputStream();
      byte[] buf = new byte[512];
      int n;
      while ((n = in.read(buf)) > 0) { b.write(buf, 0, n); if (b.size() > 4096) throw new IllegalStateException("too big"); }
      return b.toString("UTF-8");
    }
  }

  private static String err(String msg) {
    return "{\"ok\":false,\"error\":" + JSONObject.quote(msg) + "}";
  }
}
