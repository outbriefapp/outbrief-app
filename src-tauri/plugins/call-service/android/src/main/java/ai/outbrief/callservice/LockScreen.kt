package ai.outbrief.callservice

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager

/**
 * Lets the app's window show over the lock screen, and turn the screen on, while it shows a call
 * opened from its notification, as a phone app's incoming call does; once the app leaves the
 * screen it is behind the lock screen again.
 *
 * Watched for the whole process from the moment the service starts (OUTB-67): a call that rings
 * after the system killed and re-created the process (the app swiped away, memory) opens a new
 * activity, and its flags must be set as it is created. The page's plugin only loads once the
 * webview is up, and that never happens for an activity left stopped behind the lock screen.
 */
object LockScreen {
  @Volatile private var watching = false

  fun watch(context: Context) {
    if (watching) return
    synchronized(this) {
      if (watching) return
      (context.applicationContext as Application).registerActivityLifecycleCallbacks(Callbacks)
      watching = true
    }
  }

  /** The app was handed a new intent: a call opened from its notification shows over the lock screen. */
  fun newIntent(activity: Activity, intent: Intent?) {
    if (intent?.hasExtra(CallAlerts.EXTRA_CALL) == true) Callbacks.show(activity)
  }

  @Suppress("DEPRECATION")
  private fun set(activity: Activity, on: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(on)
      activity.setTurnScreenOn(on)
    } else {
      val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (on) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
    }
  }

  private object Callbacks : Application.ActivityLifecycleCallbacks {
    /** Activities shown over the lock screen now. */
    private val over = HashSet<Activity>()

    fun show(a: Activity) {
      over.add(a)
      set(a, true)
    }

    // Re-created from its task after the process was killed, the activity is handed the intent it
    // was first opened with, and the call's own only later: a call ringing now is what tells.
    override fun onActivityCreated(a: Activity, state: Bundle?) {
      if (CallAlerts.isRinging() || a.intent?.hasExtra(CallAlerts.EXTRA_CALL) == true) show(a)
    }

    override fun onActivityStopped(a: Activity) {
      // Once the call is over and the app left, it is behind the lock screen again.
      if (over.remove(a)) set(a, false)
    }

    override fun onActivityDestroyed(a: Activity) {
      over.remove(a)
    }

    override fun onActivityStarted(a: Activity) {}
    override fun onActivityResumed(a: Activity) {}
    override fun onActivityPaused(a: Activity) {}
    override fun onActivitySaveInstanceState(a: Activity, state: Bundle) {}
  }
}
