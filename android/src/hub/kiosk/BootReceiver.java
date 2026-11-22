package hub.kiosk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Bring the Hub up after a reboot or an app update. */
public class BootReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context c, Intent i) {
    Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    try { c.startActivity(open); } catch (Exception ignored) { /* the home screen opens it anyway */ }
  }
}
