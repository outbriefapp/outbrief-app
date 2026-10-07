package ai.outbrief.callservice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a reboot or an update calls ring again without opening the app first. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
      CallService.sync(context, false)
    }
  }
}
