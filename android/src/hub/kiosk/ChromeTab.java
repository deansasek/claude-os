package hub.kiosk;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Parcel;
import android.util.Log;

/**
 * A Custom Tabs session for Chrome, without AndroidX. It binds Chrome's CustomTabsService, calls warmup() and
 * newSession() over Binder by hand, and gives the session's callback binder to the Custom Tab intent as
 * android.support.customtabs.extra.SESSION. Chrome treats a Custom Tab as a session tab (partial tabs included)
 * only when the session is one its service created, so a bare intent with a made-up binder is not enough.
 *
 * The wire format is the AIDL of android.support.customtabs: ICustomTabsService (descriptor
 * "android.support.customtabs.ICustomTabsService") and ICustomTabsCallback. The AIDL declares explicit ids:
 * warmup(long) = 1 and newSession(ICustomTabsCallback) = 2. An explicit id N compiles to FIRST_CALL_TRANSACTION + N,
 * so the codes are warmup = 2 and newSession = 3, which matches the generated copy. Not yet confirmed against Chrome
 * 152 on the device. A false or failed reply falls back to no session, as does CONNECT_TIMEOUT_MS without an answer.
 */
final class ChromeTab {
  static final String PKG = "com.android.chrome";
  static final String EXTRA_SESSION = "android.support.customtabs.extra.SESSION";
  private static final String SERVICE_ACTION = "android.support.customtabs.action.CustomTabsService";
  private static final String SERVICE_DESC = "android.support.customtabs.ICustomTabsService";
  private static final String CALLBACK_DESC = "android.support.customtabs.ICustomTabsCallback";
  private static final int TX_WARMUP = 2, TX_NEW_SESSION = 3;   // FIRST_CALL_TRANSACTION + 1 and + 2 (explicit AIDL ids 1, 2)
  private static final long CONNECT_TIMEOUT_MS = 1500;
  private static final String TAG = "HubChrome";

  /** Called once, on the UI thread: the session's callback binder, or null when Chrome gave none. */
  interface Ready { void session(IBinder callbackOrNull); }

  /**
   * Where Chrome put its partial tab, on the UI thread: the window's edges in screen pixels and Chrome's layout state
   * (CustomTabsCallback.ACTIVITY_LAYOUT_STATE_*: 0 unknown, 1 bottom sheet, 2 bottom sheet maximized, 3 side sheet,
   * 4 side sheet maximized, 5 full screen). From onActivityLayout, or from onActivityResized (left = screen - width,
   * state 0) on a Chrome that sends only that one.
   */
  interface Layout { void layout(int left, int top, int right, int bottom, int state); }

  /**
   * ICustomTabsCallback (androidx browser's stableAidl/android/support/customtabs/ICustomTabsCallback.aidl):
   * onNavigationEvent = 1, extraCallback = 2, onMessageChannelReady = 3, onPostMessage = 4,
   * onRelationshipValidationResult = 5, extraCallbackWithResult = 6, onActivityResized(int height, int width, Bundle) = 7,
   * onWarmupCompleted = 8, onActivityLayout(int left, int top, int right, int bottom, int state, Bundle) = 9,
   * onMinimized = 10, onUnminimized = 11. Explicit id N is FIRST_CALL_TRANSACTION + N, the same rule as warmup/newSession.
   */
  private static final int CB_NAVIGATION = 2, CB_EXTRA = 3, CB_MESSAGE_READY = 4, CB_POST_MESSAGE = 5,
      CB_EXTRA_WITH_RESULT = 7, CB_RESIZED = 8, CB_LAYOUT = 10;

  private final Context ctx;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Layout onLayout;
  /**
   * Our side of the session: Chrome calls back here on a binder thread. The sheet's geometry (onActivityLayout,
   * onActivityResized) goes to onLayout on the UI thread; navigation events are logged; the rest are acknowledged.
   * Calls that are not oneway get an empty reply (no exception; a null Bundle for extraCallbackWithResult).
   */
  private final Binder callback = new Binder() {
    @Override protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) {
      if (code == INTERFACE_TRANSACTION) {
        if (reply != null) reply.writeString(CALLBACK_DESC);
        return true;
      }
      try {
        data.enforceInterface(CALLBACK_DESC);
        switch (code) {
          case CB_LAYOUT: {
            int l = data.readInt(), t = data.readInt(), r = data.readInt(), b = data.readInt(), state = data.readInt();
            Log.i(TAG, "onActivityLayout " + l + "," + t + " - " + r + "," + b + " state " + state);
            main.post(() -> { if (!closed) onLayout.layout(l, t, r, b, state); });
            break;
          }
          case CB_RESIZED: {
            int height = data.readInt(), width = data.readInt();
            Log.i(TAG, "onActivityResized " + width + "x" + height);
            main.post(() -> {
              int sw = ctx.getResources().getDisplayMetrics().widthPixels;
              if (!closed) onLayout.layout(Math.max(0, sw - width), 0, sw, height, 0);
            });
            break;
          }
          case CB_NAVIGATION: Log.i(TAG, "onNavigationEvent " + data.readInt()); break;
          case CB_EXTRA: Log.i(TAG, "extraCallback " + data.readString()); break;
          default: break;
        }
      } catch (Exception e) {
        Log.w(TAG, "callback " + code, e);
      }
      if (reply != null && (flags & FLAG_ONEWAY) == 0) {
        reply.writeNoException();
        if (code == CB_EXTRA_WITH_RESULT) reply.writeInt(0);   // a null Bundle
      }
      return true;
    }
  };
  private ServiceConnection conn;
  private boolean done;
  private volatile boolean closed;    // close() ran: late callbacks are dropped

  ChromeTab(Context ctx, Layout onLayout) {
    this.ctx = ctx;
    this.onLayout = onLayout;
    callback.attachInterface(null, CALLBACK_DESC);
  }

  /** Binds Chrome's service and opens a session; ready runs on the UI thread when it is set up (or failed). */
  void connect(Ready ready) {
    done = false;
    conn = new ServiceConnection() {
      @Override public void onServiceConnected(ComponentName name, IBinder service) {
        new Thread(() -> finish(ready, startSession(service)), "hub-chrome-session").start();
      }
      @Override public void onServiceDisconnected(ComponentName name) { }
    };
    main.postDelayed(() -> finish(ready, null), CONNECT_TIMEOUT_MS);
    boolean bound = false;
    try {
      bound = ctx.bindService(new Intent(SERVICE_ACTION).setPackage(PKG), conn, Context.BIND_AUTO_CREATE);
    } catch (Exception e) {
      Log.w(TAG, "bind", e);
    }
    if (!bound) finish(ready, null);
  }

  private void finish(Ready ready, IBinder session) {
    main.post(() -> {
      if (done) return;
      done = true;
      ready.session(session);
    });
  }

  /** warmup(0), then newSession(callback). Runs on a worker thread. Returns the callback binder, or null. */
  private IBinder startSession(IBinder service) {
    Parcel d = Parcel.obtain(), r = Parcel.obtain();
    try {
      d.writeInterfaceToken(SERVICE_DESC);
      d.writeLong(0L);
      service.transact(TX_WARMUP, d, r, 0);
      r.readException();
      boolean warm = r.readInt() != 0;
      if (!warm) {
        Log.w(TAG, "warmup returned false: no session");
        return null;
      }
      d.recycle(); r.recycle();
      d = Parcel.obtain(); r = Parcel.obtain();
      d.writeInterfaceToken(SERVICE_DESC);
      d.writeStrongBinder(callback);
      service.transact(TX_NEW_SESSION, d, r, 0);
      r.readException();
      boolean ok = r.readInt() != 0;
      Log.i(TAG, "warmup " + warm + " newSession " + ok);
      return ok ? callback : null;
    } catch (Exception e) {
      Log.w(TAG, "session", e);
      return null;
    } finally {
      d.recycle(); r.recycle();
    }
  }

  /** Unbinds the service. Safe to call more than once. */
  void close() {
    done = true;
    closed = true;
    if (conn != null) {
      try { ctx.unbindService(conn); } catch (Exception ignored) { }
      conn = null;
    }
  }
}
