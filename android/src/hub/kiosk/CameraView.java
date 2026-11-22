package hub.kiosk;

import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.media.MediaActionSound;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import android.util.Size;
import android.view.HapticFeedbackConstants;
import android.view.Surface;
import android.view.TextureView;
import android.webkit.WebView;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.util.Arrays;

/**
 * The tablet's camera for the Camera app (apps/camera/web/camera.ts). Camera2, no libraries.
 *
 * - The live picture is a TextureView placed UNDER the WebView (the page is see-through where the preview is),
 *   in the rectangle the page gives, in device pixels.
 * - capture(id, sound) takes a JPEG at about 1600 px on the long edge and uploads it to the PC
 *   (POST /api/photos/upload, header X-Photo-Id); the page then gets {type:"captured", id, url}.
 *   A taken photo plays the shutter click only when the page allows sounds, and always gives a short tap.
 * - The camera is open only while the page asks for it. It is closed when Claude Home is paused (onPause/onStop)
 *   and the page is told ({type:"closed", reason:"paused"}); it reopens itself when the page asks again.
 * - Failures reach the page as {type:"error", code, message}; code is one of busy, no_camera, denied, failed.
 * - Permission (CAMERA) is granted by the device owner in MainActivity.lockdown() and re-granted silently by
 *   MainActivity.requestCameraPermission, so Android's prompt never shows.
 *
 * Everything camera-related runs on one background thread (bg); view changes run on the UI thread.
 */
final class CameraView {
  /** The request code of the CAMERA permission prompt (MainActivity.onRequestPermissionsResult). */
  static final int PERMISSION_REQUEST = 44;
  private static final int BG_ARGB = 0xFFF5F0E6;   // Claude Home's paper colour, behind the page when the camera is up
  private static final long MAX_PHOTO_BYTES = 8L * 1024 * 1024;
  // the thumbnail the Photos grid uses (photos/api.ts: THUMB_PX, THUMB_MAX_BYTES); the server refuses a bigger one
  private static final int THUMB_PX = 400;
  private static final int THUMB_MAX_BYTES = 200 * 1024;
  private static final int[] THUMB_QUALITY = { 80, 60 };   // JPEG quality: 80, then lower if it is still too big
  private static final String TAG = "HubCamera";

  private static CameraView instance;

  private final MainActivity act;
  private final WebView web;
  private final Bridge bridge;
  private final FrameLayout root;

  private HandlerThread thread;
  private Handler bg;
  private TextureView texture;
  private Surface surface;
  private CameraDevice device;
  private CameraCaptureSession session;
  private ImageReader reader;
  private MediaActionSound shutter;   // made on first use (bg thread)
  private String cameraId;
  private int sensorOrientation;
  private int previewW = 1280, previewH = 960;

  // what the page asked for (set by open / move)
  private volatile boolean active = false;       // open from the page's point of view
  private volatile boolean pendingPermission = false;
  private boolean lensFront = false;
  private int px, py, pw = 1, ph = 1;
  private volatile String captureId = null;      // the photo being taken, if any
  private volatile boolean captureSound = false; // the page allows the shutter click for this photo

  private CameraView(MainActivity act, WebView web, Bridge bridge) {
    this.act = act;
    this.web = web;
    this.bridge = bridge;
    this.root = (FrameLayout) web.getParent();
  }

  /** The one camera of this app (created by the first call from the page). */
  static synchronized CameraView of(MainActivity act, WebView web, Bridge bridge) {
    if (instance == null) instance = new CameraView(act, web, bridge);
    return instance;
  }

  /** Called from MainActivity when Claude Home is paused or stopped: the camera is released at once. */
  static void stopForPause() {
    CameraView c = instance;
    if (c != null) c.stop("paused");
  }

  /** The answer to the CAMERA permission request (MainActivity.onRequestPermissionsResult, or the silent grant). */
  static void onPermission(boolean granted) {
    CameraView c = instance;
    if (c != null) c.permissionResult(granted);
  }

  // ---------- the page's calls (any thread) ----------

  /** facing "front" or "back"; x, y, w, h: the preview's rectangle in device pixels. Returns the JSON answer. */
  String open(String facing, int x, int y, int w, int h) {
    lensFront = "front".equals(facing);
    px = x; py = y; pw = Math.max(1, w); ph = Math.max(1, h);
    if (act.checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      pendingPermission = true;
      act.runOnUiThread(act::requestCameraPermission);
      return "{\"ok\":true,\"asking\":true}";
    }
    active = true;
    act.runOnUiThread(() -> {
      setWebTransparent(true);
      if (texture == null) {
        texture = new TextureView(act);
        texture.setSurfaceTextureListener(listener);
        root.addView(texture, 0);   // under the WebView: the page is see-through where the picture is
      }
      place();
      if (texture.isAvailable()) startOpen();
    });
    return "{\"ok\":true}";
  }

  void move(int x, int y, int w, int h) {
    px = x; py = y; pw = Math.max(1, w); ph = Math.max(1, h);
    act.runOnUiThread(this::place);
  }

  void close() { stop("closed"); }

  /** Take a photo and send it to the PC under this id. sound: the page allows the shutter click. */
  String capture(String id, boolean sound) {
    if (!active || session == null) return "{\"error\":\"camera is not open\"}";
    if (id == null || !id.matches("[A-Za-z0-9_-]{8,64}")) return "{\"error\":\"bad id\"}";
    if (captureId != null) return "{\"error\":\"busy\"}";
    captureSound = sound;
    captureId = id;
    bg.post(() -> takePicture(id));
    return "{\"ok\":true}";
  }

  // ---------- permission ----------
  private void permissionResult(boolean granted) {
    if (!pendingPermission) return;
    pendingPermission = false;
    if (!granted) {
      emitError(null, "denied", "ClaudeOS isn’t allowed to use the camera.");
      return;
    }
    // the page asked before the grant: open now, over the same rectangle
    active = true;
    act.runOnUiThread(() -> {
      setWebTransparent(true);
      if (texture == null) {
        texture = new TextureView(act);
        texture.setSurfaceTextureListener(listener);
        root.addView(texture, 0);
      }
      place();
      if (texture.isAvailable()) startOpen();
    });
  }

  // ---------- the view (UI thread) ----------
  private final TextureView.SurfaceTextureListener listener = new TextureView.SurfaceTextureListener() {
    @Override public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) {
      if (active) startOpen();
    }
    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int h) { configureTransform(); }
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture st) { return true; }
    @Override public void onSurfaceTextureUpdated(SurfaceTexture st) { }
  };

  private void place() {
    if (texture == null) return;
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(pw, ph);
    lp.leftMargin = px;
    lp.topMargin = py;
    texture.setLayoutParams(lp);
  }

  /** The WebView is see-through while the camera is up; the paper colour sits behind everything. */
  private void setWebTransparent(boolean on) {
    web.setBackgroundColor(on ? Color.TRANSPARENT : BG_ARGB);
    root.setBackgroundColor(on ? BG_ARGB : Color.TRANSPARENT);
  }

  /** Google's Camera2 sample rule: a rotated buffer is turned and fitted to the view. */
  private void configureTransform() {
    if (texture == null || texture.getWidth() == 0) return;
    int viewW = texture.getWidth(), viewH = texture.getHeight();
    @SuppressWarnings("deprecation")
    int rotation = act.getWindowManager().getDefaultDisplay().getRotation();
    Matrix m = new Matrix();
    RectF view = new RectF(0, 0, viewW, viewH);
    float cx = view.centerX(), cy = view.centerY();
    if (rotation == Surface.ROTATION_90 || rotation == Surface.ROTATION_270) {
      RectF buf = new RectF(0, 0, previewH, previewW);
      buf.offset(cx - buf.centerX(), cy - buf.centerY());
      m.setRectToRect(view, buf, Matrix.ScaleToFit.FILL);
      float scale = Math.max((float) viewH / previewH, (float) viewW / previewW);
      m.postScale(scale, scale, cx, cy);
      m.postRotate(90 * (rotation - 2), cx, cy);
    } else if (rotation == Surface.ROTATION_180) {
      m.postRotate(180, cx, cy);
    }
    texture.setTransform(m);
  }

  // ---------- opening the camera (bg thread) ----------
  private void startOpen() {
    ensureThread();
    bg.post(() -> {
      if (!active || device != null) return;
      try {
        CameraManager cm = (CameraManager) act.getSystemService(Context.CAMERA_SERVICE);
        cameraId = null;
        int want = lensFront ? CameraCharacteristics.LENS_FACING_FRONT : CameraCharacteristics.LENS_FACING_BACK;
        for (String id : cm.getCameraIdList()) {
          CameraCharacteristics c = cm.getCameraCharacteristics(id);
          Integer facing = c.get(CameraCharacteristics.LENS_FACING);
          if (facing != null && facing == want) {
            cameraId = id;
            Integer so = c.get(CameraCharacteristics.SENSOR_ORIENTATION);
            sensorOrientation = so == null ? 0 : so;
            break;
          }
        }
        if (cameraId == null) { fail("no_camera", "This tablet has no " + (lensFront ? "front" : "back") + " camera."); return; }
        cm.openCamera(cameraId, deviceCb, bg);
      } catch (CameraAccessException e) {
        fail(accessCode(e), "The camera isn’t available right now.");
      } catch (SecurityException e) {
        fail("denied", "ClaudeOS isn’t allowed to use the camera.");
      }
    });
  }

  private final CameraDevice.StateCallback deviceCb = new CameraDevice.StateCallback() {
    @Override public void onOpened(CameraDevice d) { device = d; createSession(); }
    @Override public void onDisconnected(CameraDevice d) { d.close(); device = null; fail("busy", "The camera was taken by another app."); }
    @Override public void onError(CameraDevice d, int error) { d.close(); device = null; fail(stateCode(error), "The camera isn’t available right now (" + error + ")."); }
    @Override public void onClosed(CameraDevice d) { }
  };

  @SuppressWarnings("deprecation")   // createCaptureSession(List, ...) is the way down to Android 9
  private void createSession() {
    try {
      CameraManager cm = (CameraManager) act.getSystemService(Context.CAMERA_SERVICE);
      CameraCharacteristics c = cm.getCameraCharacteristics(cameraId);
      StreamConfigurationMap map = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
      if (map == null) { fail("failed", "The camera has no picture sizes."); return; }
      double aspect = (double) pw / ph;
      Size preview = pick(map.getOutputSizes(SurfaceTexture.class), aspect, 1280);
      Size still = pick(map.getOutputSizes(ImageFormat.JPEG), aspect, 1600);
      previewW = preview.getWidth(); previewH = preview.getHeight();
      SurfaceTexture st = texture.getSurfaceTexture();
      if (st == null) { fail("failed", "The preview isn’t ready."); return; }
      st.setDefaultBufferSize(previewW, previewH);
      surface = new Surface(st);
      reader = ImageReader.newInstance(still.getWidth(), still.getHeight(), ImageFormat.JPEG, 2);
      reader.setOnImageAvailableListener(this::onStill, bg);
      device.createCaptureSession(Arrays.asList(surface, reader.getSurface()), sessionCb, bg);
    } catch (CameraAccessException e) {
      fail(accessCode(e), "The camera preview couldn’t start.");
    } catch (RuntimeException e) {
      fail("failed", "The camera preview couldn’t start.");
    }
  }

  /** The size with the right shape, nearest to the wanted long edge (preview: 1280, photo: 1600). */
  private static Size pick(Size[] sizes, double aspect, int longEdge) {
    Size best = sizes[0];
    double bestScore = Double.MAX_VALUE;
    for (Size s : sizes) {
      double a = (double) s.getWidth() / s.getHeight();
      int long_ = Math.max(s.getWidth(), s.getHeight());
      double score = Math.abs(Math.log(a / aspect)) * 10 + Math.abs(long_ - longEdge) / (double) longEdge;
      if (score < bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  private final CameraCaptureSession.StateCallback sessionCb = new CameraCaptureSession.StateCallback() {
    @Override public void onConfigured(CameraCaptureSession s) {
      session = s;
      try {
        CaptureRequest.Builder b = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
        b.addTarget(surface);
        b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
        s.setRepeatingRequest(b.build(), null, bg);
        act.runOnUiThread(CameraView.this::configureTransform);
        emit("{\"type\":\"opened\"}");
      } catch (CameraAccessException e) {
        fail(accessCode(e), "The camera preview couldn’t start.");
      } catch (IllegalStateException e) {
        fail("failed", "The camera preview couldn’t start.");
      }
    }
    @Override public void onConfigureFailed(CameraCaptureSession s) { fail("failed", "The camera preview couldn’t start."); }
  };

  // ---------- taking a photo (bg thread) ----------
  private void takePicture(String id) {
    if (session == null || device == null || reader == null) { captureId = null; emitError(id, "failed", "The camera isn’t ready."); return; }
    try {
      CaptureRequest.Builder b = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
      b.addTarget(reader.getSurface());
      b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
      b.set(CaptureRequest.JPEG_QUALITY, (byte) 92);
      b.set(CaptureRequest.JPEG_ORIENTATION, jpegOrientation());
      session.capture(b.build(), null, bg);
    } catch (CameraAccessException e) {
      captureId = null;
      emitError(id, accessCode(e), "That one didn’t take.");
    } catch (IllegalStateException e) {
      captureId = null;
      emitError(id, "failed", "That one didn’t take.");
    }
  }

  @SuppressWarnings("deprecation")
  private int jpegOrientation() {
    int rot;
    switch (act.getWindowManager().getDefaultDisplay().getRotation()) {
      case Surface.ROTATION_90: rot = 90; break;
      case Surface.ROTATION_180: rot = 180; break;
      case Surface.ROTATION_270: rot = 270; break;
      default: rot = 0;
    }
    return lensFront ? (sensorOrientation + rot) % 360 : (sensorOrientation - rot + 360) % 360;
  }

  private void onStill(ImageReader r) {   // bg thread
    Image img = null;
    String id = captureId;
    boolean sound = captureSound;
    try {
      img = r.acquireLatestImage();
      if (img == null || id == null) return;
      ByteBuffer buf = img.getPlanes()[0].getBuffer();
      if (buf.remaining() > MAX_PHOTO_BYTES) { emitError(id, "failed", "That picture is too big."); return; }
      byte[] bytes = new byte[buf.remaining()];
      buf.get(bytes);
      confirmShot(sound);
      upload(id, bytes);
    } catch (RuntimeException e) {
      emitError(id, "failed", "That one didn’t take.");
    } finally {
      if (img != null) img.close();
      captureId = null;
    }
  }

  /** The photo is taken: the shutter click (only if the page allows sounds), and a short tap. Neither may stop the photo. */
  private void confirmShot(boolean sound) {
    if (sound) {
      try {
        if (shutter == null) { shutter = new MediaActionSound(); shutter.load(MediaActionSound.SHUTTER_CLICK); }
        shutter.play(MediaActionSound.SHUTTER_CLICK);
      } catch (RuntimeException ignored) { }
    }
    act.runOnUiThread(() -> {
      if (texture != null) texture.performHapticFeedback(Build.VERSION.SDK_INT >= 30
          ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.KEYBOARD_TAP);
    });
  }

  /** POST the JPEG to the Hub server; the answer goes to the page. */
  private void upload(String id, byte[] bytes) {
    HttpURLConnection c = null;
    try {
      c = (HttpURLConnection) new URL(act.serverOrigin() + "/api/photos/upload").openConnection();
      c.setRequestMethod("POST");
      c.setConnectTimeout(8000);
      c.setReadTimeout(20000);
      c.setDoOutput(true);
      c.setFixedLengthStreamingMode(bytes.length);
      c.setRequestProperty("Content-Type", "image/jpeg");
      c.setRequestProperty("X-Photo-Id", id);
      try (OutputStream os = c.getOutputStream()) { os.write(bytes); }
      int code = c.getResponseCode();
      String body = read(code >= 400 ? c.getErrorStream() : c.getInputStream());
      JSONObject o = new JSONObject(body);
      if (o.optBoolean("ok")) {
        emit(new JSONObject().put("type", "captured").put("id", id).put("url", o.optString("url")).toString());
        sendThumb(o.optString("id", id), bytes);   // same bg thread, after the page has its answer
      } else {
        emitError(id, "failed", "The photo didn’t reach your PC (" + o.optString("error", "error") + ").");
      }
    } catch (Exception e) {
      emitError(id, "failed", "The photo didn’t reach your PC. It will need another try.");
    } finally {
      if (c != null) c.disconnect();
    }
  }

  /**
   * A thumbnail of the photo just uploaded: 400 px on the long side, JPEG at q80 (lower if it is over 200 KB),
   * POSTed to the PC under the id the upload answered with. Runs on the bg thread. Any failure is logged and
   * ignored: the web backfill (photos/web/thumb.ts) makes the thumbnail later.
   */
  private void sendThumb(String id, byte[] full) {
    HttpURLConnection c = null;
    Bitmap src = null, small = null;
    try {
      src = BitmapFactory.decodeByteArray(full, 0, full.length);
      if (src == null) return;
      float k = THUMB_PX / (float) Math.max(src.getWidth(), src.getHeight());
      small = Bitmap.createScaledBitmap(src, Math.max(1, Math.round(src.getWidth() * k)),
          Math.max(1, Math.round(src.getHeight() * k)), true);
      byte[] jpg = null;
      for (int q : THUMB_QUALITY) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        small.compress(Bitmap.CompressFormat.JPEG, q, out);
        jpg = out.toByteArray();
        if (jpg.length <= THUMB_MAX_BYTES) break;
      }
      if (jpg == null || jpg.length > THUMB_MAX_BYTES) { Log.w(TAG, "thumb too big, left to the backfill"); return; }
      c = (HttpURLConnection) new URL(act.serverOrigin() + "/api/photos/thumb?id="
          + URLEncoder.encode(id, "UTF-8")).openConnection();
      c.setRequestMethod("POST");
      c.setConnectTimeout(8000);
      c.setReadTimeout(20000);
      c.setDoOutput(true);
      c.setFixedLengthStreamingMode(jpg.length);
      c.setRequestProperty("Content-Type", "image/jpeg");
      try (OutputStream os = c.getOutputStream()) { os.write(jpg); }
      int code = c.getResponseCode();
      if (code >= 400) Log.w(TAG, "thumb refused: HTTP " + code);
    } catch (Exception | OutOfMemoryError e) {
      Log.w(TAG, "thumb not sent", e);
    } finally {
      if (small != null && small != src) small.recycle();   // createScaledBitmap returns src itself when no size change
      if (src != null) src.recycle();
      if (c != null) c.disconnect();
    }
  }

  private static String read(InputStream in) throws java.io.IOException {
    if (in == null) return "{}";
    try (InputStream i = in) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] b = new byte[4096];
      int n;
      while ((n = i.read(b)) > 0) out.write(b, 0, n);
      return out.toString("UTF-8");
    }
  }

  // ---------- the codes the page words (camera.ts): busy, no_camera, denied, failed ----------

  /** A CameraAccessException: another app has the camera (busy), it is switched off (denied), or anything else (failed). */
  private static String accessCode(CameraAccessException e) {
    switch (e.getReason()) {
      case CameraAccessException.CAMERA_IN_USE:
      case CameraAccessException.MAX_CAMERAS_IN_USE: return "busy";
      case CameraAccessException.CAMERA_DISABLED: return "denied";
      default: return "failed";
    }
  }

  /** CameraDevice.StateCallback.onError codes, as the same three words. */
  private static String stateCode(int error) {
    switch (error) {
      case CameraDevice.StateCallback.ERROR_CAMERA_IN_USE:
      case CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE: return "busy";
      case CameraDevice.StateCallback.ERROR_CAMERA_DISABLED: return "denied";
      default: return "failed";
    }
  }

  // ---------- starting, stopping, telling the page ----------
  private void ensureThread() {
    if (thread == null) {
      thread = new HandlerThread("hub-camera");
      thread.start();
      bg = new Handler(thread.getLooper());
    }
  }

  /** Release the camera and the picture, silently. */
  private void teardown() {
    active = false;
    pendingPermission = false;
    captureId = null;
    if (bg != null) bg.post(this::releaseNow);
    act.runOnUiThread(() -> {
      if (texture != null) { root.removeView(texture); texture = null; }
      setWebTransparent(false);
    });
  }

  /** Stop, and tell the page why. */
  private void stop(String reason) {
    boolean was = active;
    teardown();
    if (was) {
      try { emit(new JSONObject().put("type", "closed").put("reason", reason).toString()); }
      catch (Exception ignored) { }
    }
  }

  private void fail(String code, String message) {
    emitError(null, code, message);
    teardown();
  }

  private void releaseNow() {   // bg thread
    try { if (session != null) session.close(); } catch (Exception ignored) { }
    session = null;
    try { if (device != null) device.close(); } catch (Exception ignored) { }
    device = null;
    if (reader != null) { reader.close(); reader = null; }
    if (surface != null) { surface.release(); surface = null; }
  }

  private void emitError(String id, String code, String message) {
    try {
      JSONObject o = new JSONObject().put("type", "error").put("code", code).put("message", message);
      if (id != null) o.put("id", id);
      emit(o.toString());
    } catch (Exception ignored) { }
  }

  /** Hand an event to the page, only while the page is the Claude Home server. */
  private void emit(String json) {
    web.post(() -> {
      if (bridge.isAllowed()) web.evaluateJavascript("window.hubCamera && window.hubCamera(" + json + ")", null);
    });
  }
}
