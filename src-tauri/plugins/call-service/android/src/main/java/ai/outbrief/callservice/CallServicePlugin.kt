package ai.outbrief.callservice

import android.Manifest
import android.app.Activity
import android.app.Application
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import android.view.WindowManager
import android.webkit.WebView
import androidx.core.app.NotificationManagerCompat
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

/**
 * The page's side of the call service (src/callService.ts): it hands over what the service follows
 * and rings with, asks for the notification permission and opens the system settings the service
 * depends on. It also tells the service when the page is on screen, and lets a call opened from a
 * notification show over the lock screen.
 */
@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
  ],
)
class CallServicePlugin(private val activity: Activity) : Plugin(activity) {
  private val config = CallConfig(activity)
  /** The window shows over the lock screen for a call opened from its notification. */
  private var overLockScreen = false

  override fun load(webView: WebView) {
    super.load(webView)
    // Tauri's own lifecycle hooks (Plugin.onPause / onResume) are never called: its generated
    // TauriLifecycleObserver is not registered. The activity's callbacks tell when the page is on
    // screen instead.
    activity.application.registerActivityLifecycleCallbacks(Lifecycle())
    shown()
    showCall(activity.intent)
  }

  private inner class Lifecycle : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(a: Activity) {
      if (a === activity) shown()
    }

    override fun onActivityPaused(a: Activity) {
      if (a === activity) AppState.foreground = false
    }

    override fun onActivityStopped(a: Activity) {
      // Once the call is over and the app left, it is behind the lock screen again.
      if (a === activity && overLockScreen) setOverLockScreen(false)
    }

    override fun onActivityDestroyed(a: Activity) {
      if (a !== activity) return
      AppState.foreground = false
      a.application.unregisterActivityLifecycleCallbacks(this)
    }

    override fun onActivityCreated(a: Activity, state: Bundle?) {}
    override fun onActivityStarted(a: Activity) {}
    override fun onActivitySaveInstanceState(a: Activity, state: Bundle) {}
  }

  override fun onNewIntent(intent: Intent) = showCall(intent)

  private fun shown() {
    AppState.foreground = true
    CallAlerts.appShown(activity)
  }

  private fun showCall(intent: Intent?) {
    if (intent?.hasExtra(CallAlerts.EXTRA_CALL) == true) setOverLockScreen(true)
  }

  @Suppress("DEPRECATION")
  private fun setOverLockScreen(on: Boolean) {
    overLockScreen = on
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(on)
      activity.setTurnScreenOn(on)
    } else {
      val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (on) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
    }
  }

  /**
   * `{ enabled, serverUrl, token, e2eKey, modes, ringtoneId, texts }`: starts, updates or stops the
   * service. Resolves `{ ringtoneId }`: the ringtone the service has a copy of.
   */
  @Command
  fun configure(invoke: Invoke) {
    val reconnect = config.save(invoke.getArgs())
    if (reconnect) CallInbox.clear(activity)
    CallAlerts.createChannels(activity, config.texts)
    CallService.sync(activity, reconnect)
    invoke.resolve(JSObject().put("ringtoneId", config.ringtoneId))
  }

  /**
   * Resolves `{ entries }`: the calls the service heard of since the last take, `{ id, event?,
   * status? }` each (`CallInbox`), so the page can tell its history about calls another device
   * answered while it was paused (OUTB-63).
   */
  @Command
  fun takeInbox(invoke: Invoke) {
    invoke.resolve(JSObject().put("entries", CallInbox.take(activity)))
  }

  /** `{ id, audio }`: the incoming ringtone's file, base64, for the service to ring with. */
  @Command
  fun setRingtone(invoke: Invoke) {
    val args = invoke.getArgs()
    val id = args.getString("id")
    val bytes = Base64.decode(args.getString("audio"), Base64.DEFAULT)
    val file = File(activity.filesDir, CallAlerts.RINGTONE_FILE)
    val partial = File(activity.filesDir, "${CallAlerts.RINGTONE_FILE}.part")
    partial.writeBytes(bytes)
    if (!partial.renameTo(file)) {
      invoke.reject("could not save the ringtone")
      return
    }
    config.saveRingtoneId(id)
    invoke.resolve()
  }

  /**
   * What keeps calls from ringing in the background: `notifications` (granted / denied / prompt),
   * `fullScreen` (may show over the lock screen), `popUp` (may open the incoming-call screen over
   * other apps, OUTB-65), `unrestricted` (exempt from battery optimization);
   * also `connected`: the service's stream is open.
   */
  @Command
  fun getStatus(invoke: Invoke) {
    invoke.resolve(status())
  }

  /** Asks for the notification permission (Android 13+); resolves the status afterwards. */
  @Command
  fun requestNotifications(invoke: Invoke) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      getPermissionState("notifications") == PermissionState.GRANTED
    ) {
      invoke.resolve(status())
      return
    }
    requestPermissionForAlias("notifications", invoke, "notificationsAnswered")
  }

  @PermissionCallback
  private fun notificationsAnswered(invoke: Invoke) {
    invoke.resolve(status())
  }

  /**
   * `{ target }`: `notifications`, `fullScreen`, `popUp` or `battery`, the system page that changes
   * it.
   */
  @Command
  fun openSettings(invoke: Invoke) {
    val pkg = activity.packageName
    val intent = when (invoke.getArgs().getString("target")) {
      "notifications" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
      } else {
        appDetails(pkg)
      }
      "fullScreen" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$pkg"))
      } else {
        appDetails(pkg)
      }
      "popUp" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$pkg"))
      } else {
        appDetails(pkg)
      }
      "battery" ->
        @Suppress("BatteryLife")
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg"))
      else -> appDetails(pkg)
    }
    try {
      activity.startActivity(intent)
    } catch (e: Exception) {
      // Some phones have no such page: the app's own settings page has them all.
      activity.startActivity(appDetails(pkg))
    }
    invoke.resolve()
  }

  private fun appDetails(pkg: String) =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))

  private fun status(): JSObject {
    val notifications = when {
      NotificationManagerCompat.from(activity).areNotificationsEnabled() -> "granted"
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        getPermissionState("notifications").let {
          it == PermissionState.PROMPT || it == PermissionState.PROMPT_WITH_RATIONALE
        } -> "prompt"
      else -> "denied"
    }
    val fullScreen = Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
      activity.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
    val unrestricted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
      activity.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(activity.packageName)
    return JSObject()
      .put("notifications", notifications)
      .put("fullScreen", fullScreen)
      .put("popUp", CallAlerts.mayPopUp(activity))
      .put("unrestricted", unrestricted)
      .put("connected", CallService.connected)
  }
}
