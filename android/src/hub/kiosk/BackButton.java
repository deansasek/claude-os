package hub.kiosk;

import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;

/**
 * The floating "back to ClaudeOS" button: a small clay disc with a cream C, drawn over an allowed Android app
 * (Launcher.launch calls showAfterLaunch). It is ClaudeOS's own view, not Android UI.
 *
 * - Needs "display over other apps" (SYSTEM_ALERT_WINDOW). It is never requested here: without the permission
 *   nothing is drawn, and that is logged once.
 * - Shown only while an allowed app is in front. Removed when ClaudeOS resumes (MainActivity.onResume) and when tapped.
 * - Tap: brings ClaudeOS to the front. Drag: moves it along the right edge, never over the status bar or nav bar.
 */
final class BackButton extends View {
  private static final String TAG = MainActivity.TAG;
  private static final int SIZE_DP = 56, MARGIN_DP = 12;
  private static final int CLAY = 0xFFD97757, CREAM = 0xFFF5F0E6;
  private static final Handler ui = new Handler(Looper.getMainLooper());
  private static BackButton shown;                 // the one button on screen, or null
  private static boolean warnedNoPermission = false;

  private final WindowManager wm;
  private final WindowManager.LayoutParams lp;
  private final int slop;
  private final Paint disc = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final RectF arcBox = new RectF();
  private float downRawX, downRawY, downX, downY;
  private boolean dragged;

  private BackButton(Context app, WindowManager wm, int size) {
    super(app);
    this.wm = wm;
    this.slop = ViewConfiguration.get(app).getScaledTouchSlop();
    disc.setColor(CLAY);
    ring.setStyle(Paint.Style.STROKE);
    ring.setColor(CREAM);
    ring.setStrokeWidth(size * 0.10f);
    ring.setStrokeCap(Paint.Cap.ROUND);
    setContentDescription("Back to ClaudeOS");
    lp = new WindowManager.LayoutParams(size, size,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
        PixelFormat.TRANSLUCENT);
    lp.gravity = Gravity.TOP | Gravity.LEFT;
  }

  /**
   * Called by Launcher.launch once an allowed app has been started. Checks the permission now (logged once if it is
   * missing), and draws the button a moment later, only if that app is still in front. Any thread.
   */
  static void showAfterLaunch(Context c) {
    Context app = c.getApplicationContext();
    if (!Settings.canDrawOverlays(app)) {
      if (!warnedNoPermission) {
        warnedNoPermission = true;
        Log.w(TAG, "back button: 'display over other apps' is not granted, so it is not drawn");
      }
      return;
    }
    ui.post(() -> ui.postDelayed(() -> { if (MainActivity.allowedAppInFront()) show(app); }, 800));
  }

  /** Draws the button at the right edge, mid height. Main thread. */
  private static void show(Context app) {
    if (shown != null) return;
    WindowManager wm = app.getSystemService(WindowManager.class);
    if (wm == null) return;
    int size = Math.round(SIZE_DP * app.getResources().getDisplayMetrics().density);
    BackButton b = new BackButton(app, wm, size);
    DisplayMetrics dm = app.getResources().getDisplayMetrics();
    int margin = Math.round(MARGIN_DP * dm.density);
    b.lp.x = dm.widthPixels - size - margin;
    b.lp.y = (dm.heightPixels - size) / 2;
    b.clamp();
    try {
      wm.addView(b, b.lp);
      shown = b;
      MainActivity.trace("back button shown");
    } catch (RuntimeException e) {
      Log.w(TAG, "back button: couldn't draw", e);
    }
  }

  /** Removes the button if it is up. Main thread. */
  static void hide() {
    BackButton b = shown;
    if (b == null) return;
    shown = null;
    try { b.wm.removeView(b); } catch (RuntimeException ignored) { }
    MainActivity.trace("back button hidden");
  }

  private int systemDimen(String name) {
    int id = getResources().getIdentifier(name, "dimen", "android");
    return id > 0 ? getResources().getDimensionPixelSize(id) : 0;
  }

  /** Keeps the button on screen, below the status bar and above the navigation bar. */
  private void clamp() {
    DisplayMetrics dm = getResources().getDisplayMetrics();
    int size = lp.width;
    int top = Math.max(MainActivity.topBandPx(), systemDimen("status_bar_height"));
    int bottom = dm.heightPixels - Math.max(MainActivity.bottomBandPx(), systemDimen("navigation_bar_height"));
    lp.x = Math.max(0, Math.min(lp.x, dm.widthPixels - size));
    lp.y = Math.max(top, Math.min(lp.y, bottom - size));
  }

  @Override protected void onDraw(Canvas c) {
    float w = getWidth(), h = getHeight();
    c.drawCircle(w / 2f, h / 2f, w / 2f, disc);
    float inset = w * 0.32f;
    arcBox.set(inset, inset, w - inset, h - inset);
    c.drawArc(arcBox, 45, 270, false, ring);   // the C: open on the right
  }

  @Override public boolean onTouchEvent(MotionEvent e) {
    switch (e.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
        downRawX = e.getRawX(); downRawY = e.getRawY();
        downX = lp.x; downY = lp.y;
        dragged = false;
        return true;
      case MotionEvent.ACTION_MOVE:
        float dx = e.getRawX() - downRawX, dy = e.getRawY() - downRawY;
        if (!dragged && Math.hypot(dx, dy) > slop) dragged = true;
        if (dragged && shown == this) {
          lp.x = Math.round(downX + dx);
          lp.y = Math.round(downY + dy);
          clamp();
          try { wm.updateViewLayout(this, lp); } catch (RuntimeException ignored) { }
        }
        return true;
      case MotionEvent.ACTION_UP:
        if (!dragged) performClick();
        return true;
      default:
        return true;
    }
  }

  @Override public boolean performClick() {
    super.performClick();
    backToClaudeOS();
    return true;
  }

  /** Brings ClaudeOS (MainActivity) to the front and takes the button away. */
  private void backToClaudeOS() {
    hide();
    Intent i = new Intent(getContext(), MainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
    try { getContext().startActivity(i); }
    catch (RuntimeException e) { Log.w(TAG, "back button: couldn't bring ClaudeOS to the front", e); }
  }
}
