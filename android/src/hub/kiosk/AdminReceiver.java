package hub.kiosk;

import android.app.admin.DeviceAdminReceiver;
import android.content.ComponentName;
import android.content.Context;

/** The device-admin component. Made device owner once, from the PC:
 *  adb shell dpm set-device-owner hub.kiosk/.AdminReceiver */
public class AdminReceiver extends DeviceAdminReceiver {
  public static ComponentName component(Context c) { return new ComponentName(c, AdminReceiver.class); }
}
