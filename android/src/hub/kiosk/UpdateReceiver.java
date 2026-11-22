package hub.kiosk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;

/** The PackageInstaller's answer to a silent self-update (see Updater). Success restarts the app by itself. */
public class UpdateReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context c, Intent i) {
    int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
    Log.i(MainActivity.TAG, "update result " + status);
    Updater.finished(status == PackageInstaller.STATUS_SUCCESS);
  }
}
