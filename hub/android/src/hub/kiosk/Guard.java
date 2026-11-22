package hub.kiosk;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Set;

/**
 * Desk mode's helper, for a tablet where the app isn't device owner. As an accessibility service it:
 *   - lays an invisible strip over the top edge of the screen, above Android's status bar, while Claude
 *     Home is in front. A swipe down from the edge lands on the strip instead of Android, so Android's
 *     pull-down never opens; the strip opens Claude Home's own pull-down instead.
 *   - if Android's pull-down still opens some other way, closes it (Back, only while it covers Claude Home)
 *   - leaves the recents screen or the old launcher straight away and brings Claude Home back
 * It reads nothing on screen, only which app's window came to the front (and whether it's the pull-down).
 * It stands down while paused (you opened Android's settings from Claude Home) or switched off.
 */
public class Guard extends AccessibilityService {
  private final Set<String> launchers = new HashSet<>();
  private final Handler h = new Handler(Looper.getMainLooper());
  private long lastBounce = 0, closingUntil = 0;
  private View strip;
  private boolean stripShown = false;

  static volatile boolean connected = false;
  private static volatile Guard self;

  /** The last few events, for diagnostics (app + window kind only; no screen content). */
  static final Deque<String> recent = new ArrayDeque<>();
  private static void note(String s) {
    synchronized (recent) { recent.addFirst(System.currentTimeMillis() % 100000 + " " + s); while (recent.size() > 25) recent.removeLast(); }
  }

  @Override public boolean onUnbind(Intent i) { connected = false; self = null; return super.onUnbind(i); }
  @Override public void onDestroy() { connected = false; self = null; removeStrip(); removeBottom(); super.onDestroy(); }

  @Override protected void onServiceConnected() {
    connected = true;
    self = this;
    Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
    for (ResolveInfo r : getPackageManager().queryIntentActivities(home, PackageManager.MATCH_ALL)) {
      String p = r.activityInfo.packageName;
      if (!p.equals(getPackageName()) && !p.equals("com.android.settings")) launchers.add(p);
    }
    note("connected; launchers=" + launchers);
    refresh();
  }

  /**
   * The strip covers Android's status bar, so it paints what Claude Home would show there: the sidebar's
   * colour and its divider on the left, the page background to the right. It then reads as part of the app.
   */
  static volatile int railColor = 0, lineColor = 0, railPx = 0;
  static void paintStrip(int color) {
    Guard g = self;
    if (g != null) g.h.post(() -> { if (g.strip != null) g.strip.invalidate(); });
  }
  static void setRail(int rail, int line, int px) {
    railColor = rail; lineColor = line; railPx = px;
    paintStrip(MainActivity.topColor);
  }

  /** What's at the top edge right now, as [x0, x1, colour] runs across the screen (the page sends it). */
  static volatile int[][] band = null;
  static void setBand(int[][] runs) { band = runs; paintStrip(MainActivity.topColor); }

  private static final class StripView extends View {
    private final android.graphics.Paint p = new android.graphics.Paint();
    StripView(android.content.Context c) { super(c); }
    @Override protected void onDraw(android.graphics.Canvas c) {
      c.drawColor(MainActivity.topColor);
      int[][] runs = band;
      if (runs != null) {
        for (int[] r : runs) { p.setColor(r[2]); c.drawRect(r[0], 0, r[1], getHeight(), p); }
        return;
      }
      if (railPx > 0 && railColor != 0) {
        p.setColor(railColor);
        c.drawRect(0, 0, railPx, getHeight(), p);
        if (lineColor != 0) { p.setColor(lineColor); c.drawRect(railPx - 1, 0, railPx, getHeight(), p); }
      }
    }
  }

  static int stripHeight() { Guard g = self; return g != null && g.strip != null ? g.strip.getHeight() : 0; }
  /** Desk mode's bottom strip's height in screen px (0 when it isn't up). */
  static int bottomHeight() { Guard g = self; return g != null && g.bottom != null ? g.bottom.getHeight() : 0; }

  /** Re-check whether the edge strip should be up (Claude Home in front, Desk mode on and not paused). */
  static void refreshStrip() { Guard g = self; if (g != null) g.h.post(g::refresh); }

  /** As device owner the policies do this job (status bar off, lock task): no strip, no guard. */
  private boolean owner() { return ((android.app.admin.DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE)).isDeviceOwnerApp(getPackageName()); }
  private boolean shouldGuard() { return !owner() && Kiosk.enabled(this) && !Kiosk.paused() && MainActivity.isInFront(); }

  private void refresh() {
    boolean want = shouldGuard();
    if (want && !stripShown) showStrip();
    else if (!want && stripShown) removeStrip();
    if (want && bottom == null) showBottom();
    else if (!want && bottom != null) removeBottom();
  }

  // ---------- the bottom strip: a swipe up opens Claude Home's app switcher ----------
  // Without device owner, Android owns swipes from the bottom edge (recents, home). An invisible strip about
  // the height of the navigation bar takes them first: a swipe up calls window.hubSwitcher() through
  // MainActivity; every other touch is passed on to the page underneath, so taps there still work.
  private View bottom;
  private void showBottom() {
    try {
      WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
      float dp = getResources().getDisplayMetrics().density;
      int nb = 0;
      int id = getResources().getIdentifier("navigation_bar_height", "dimen", "android");
      if (id > 0) nb = getResources().getDimensionPixelSize(id);
      int height = Math.max(nb, Math.round(32 * dp));
      WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
          WindowManager.LayoutParams.MATCH_PARENT, height,
          WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
          WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
              | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
          PixelFormat.TRANSLUCENT);
      lp.gravity = Gravity.BOTTOM;
      if (Build.VERSION.SDK_INT >= 28) lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      if (Build.VERSION.SDK_INT >= 30) lp.setFitInsetsTypes(0);
      View v = new View(this);
      final float[] start = { -1, 0 };
      final float lift = 24 * dp;
      v.setOnTouchListener((view, ev) -> {
        int act = ev.getActionMasked();
        if (act == MotionEvent.ACTION_DOWN) { start[0] = ev.getRawY(); start[1] = ev.getRawX(); }
        if (start[0] < 0) return true;   // this gesture already opened the switcher: swallow the rest
        if (act == MotionEvent.ACTION_MOVE) {
          float up = start[0] - ev.getRawY();
          if (up > lift && up > Math.abs(ev.getRawX() - start[1])) {
            start[0] = -1;
            MotionEvent cancel = MotionEvent.obtain(ev);
            cancel.setAction(MotionEvent.ACTION_CANCEL);
            MainActivity.forwardTouch(cancel);
            cancel.recycle();
            MainActivity.openSwitcher();
            return true;
          }
        }
        MainActivity.forwardTouch(ev);
        return true;
      });
      wm.addView(v, lp);
      bottom = v;
      note("bottom strip on " + height + "px");
    } catch (Exception e) {
      note("bottom strip failed " + e);
    }
  }

  private void removeBottom() {
    if (bottom == null) return;
    try { ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(bottom); } catch (Exception ignored) { }
    bottom = null;
    note("bottom strip off");
  }

  // ---------- the edge strip ----------
  private void showStrip() {
    try {
      WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
      int sb = 0;
      int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
      if (id > 0) sb = getResources().getDimensionPixelSize(id);
      float dp = getResources().getDisplayMetrics().density;
      int height = Math.max(sb, Math.round(24 * dp)) + Math.round(2 * dp);   // just over Android's status bar
      WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
          WindowManager.LayoutParams.MATCH_PARENT, height,
          WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
          WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
              | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
          PixelFormat.TRANSLUCENT);
      lp.gravity = Gravity.TOP;
      if (Build.VERSION.SDK_INT >= 28) lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      if (Build.VERSION.SDK_INT >= 30) lp.setFitInsetsTypes(0);
      View v = new StripView(this);
      final float[] startY = { -1 };
      final float pull = 24 * dp;
      v.setOnTouchListener((view, ev) -> {
        switch (ev.getActionMasked()) {
          case MotionEvent.ACTION_DOWN: startY[0] = ev.getRawY(); return true;
          case MotionEvent.ACTION_MOVE:
            if (startY[0] >= 0 && ev.getRawY() - startY[0] > pull) { startY[0] = -1; MainActivity.openPullDown(); }
            return true;
          case MotionEvent.ACTION_UP:
            if (startY[0] >= 0) MainActivity.openPullDown();   // a tap on the edge opens it too
            startY[0] = -1;
            return true;
          default: return true;
        }
      });
      wm.addView(v, lp);
      strip = v;
      stripShown = true;
      MainActivity.setTopColor(MainActivity.topColor);   // status bar can now stay put under the strip
      note("strip on " + height + "px");
    } catch (Exception e) {
      note("strip failed " + e);
    }
  }

  private void removeStrip() {
    if (strip == null) { stripShown = false; return; }
    try { ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(strip); } catch (Exception ignored) { }
    strip = null;
    stripShown = false;
    note("strip off");
  }

  // ---------- fallback: close Android's pull-down if it opens anyway ----------
  /** Is this systemui event the notification shade / quick settings? Checks the window's title only; nothing is kept. */
  private static boolean isShade(AccessibilityEvent e) {
    java.util.List<CharSequence> t = e.getText();
    if (t == null || t.isEmpty() || t.get(0) == null) return false;
    String title = t.get(0).toString().toLowerCase();
    return title.contains("shade") || title.contains("quick settings") || title.contains("notification");
  }

  /** Keep closing the shade for a few seconds (it can't close while a finger is still dragging it). */
  private void closeShade() {
    long now = System.currentTimeMillis();
    boolean already = now < closingUntil;
    closingUntil = now + 4000;
    if (already) return;
    h.post(new Runnable() {
      boolean closedOnce = false;
      @Override public void run() {
        if (Build.VERSION.SDK_INT >= 31) performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE);
        // this tablet ignores "dismiss shade"; Back closes it, sent only while the shade covers Claude Home
        if (MainActivity.shadeCovering()) { performGlobalAction(GLOBAL_ACTION_BACK); closedOnce = true; }
        else if (closedOnce) { closingUntil = 0; MainActivity.openPullDown(); return; }
        if (System.currentTimeMillis() < closingUntil) h.postDelayed(this, 150);
      }
    });
  }

  @Override public void onAccessibilityEvent(AccessibilityEvent e) {
    if (owner()) return;   // device owner: the policies hold the tablet, this helper stays out of it
    CharSequence pkg = e.getPackageName();
    String p = pkg == null ? "" : pkg.toString();
    int type = e.getEventType();
    boolean shade = p.equals("com.android.systemui") && type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && isShade(e);
    if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
      note(p + (shade ? " shade" : " " + e.getClassName()));
      refresh();
    }
    if (!Kiosk.enabled(this) || Kiosk.paused()) return;

    if (shade) {
      closeShade();
    } else if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && launchers.contains(p)) {
      long now = System.currentTimeMillis();
      if (now - lastBounce < 400) return;
      lastBounce = now;
      Intent back = new Intent(this, MainActivity.class)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
      try { startActivity(back); } catch (Exception ignored) { performGlobalAction(GLOBAL_ACTION_HOME); }
    }
  }

  @Override public void onInterrupt() { }
}
