package ai.outbrief.callservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.os.HandlerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** Whether the app's page is on screen: then it rings calls itself and the service stays quiet. */
object AppState {
  @Volatile var foreground = false
}

/**
 * Rings calls the service hears of while the page is not on screen: a full-screen notification
 * (over the lock screen) and the incoming ringtone, until the page opens, another device takes the
 * call, or `RING_TIMEOUT_MS` passes and it becomes a missed-call notification. Outside the ringing
 * time of the modes that are on a call does not ring: it is a silent missed-call notification,
 * as in the app; so is a call heard of more than `RING_WINDOW_MS` after it came in.
 */
object CallAlerts {
  private const val TAG = "OutBriefCalls"
  const val SERVICE_CHANNEL = "outbrief.service"
  private const val CALL_CHANNEL = "outbrief.calls"
  private const val MISSED_CHANNEL = "outbrief.missed"
  const val SERVICE_NOTIFICATION = 1
  private const val CALL_NOTIFICATION = 2
  private const val MISSED_NOTIFICATION = 3
  /** Extra of the intent a call notification opens the app with: the call's event id. */
  const val EXTRA_CALL = "ai.outbrief.callservice.CALL"
  /** About as long as a phone rings before the call counts as missed. */
  private const val RING_TIMEOUT_MS = 60_000L
  /**
   * A call heard of later than this after the server received it was never rung in time (the phone
   * was off or offline, or it is pending from before an update): it is missed, not rung now. The
   * page's `RING_WINDOW_MS` (src/call/answered.ts).
   */
  private const val RING_WINDOW_MS = 2 * 60_000L
  const val RINGTONE_FILE = "outbrief-ringtone"

  private val main = Handler(Looper.getMainLooper())
  /** Calls ringing now, by event id. */
  private val ringing = LinkedHashMap<String, Caller>()
  /** Missed-call notifications on show, so another device taking the call clears them. */
  private val missed = HashSet<String>()
  private var player: MediaPlayer? = null
  private var vibrating: Vibrator? = null

  fun createChannels(context: Context, texts: Texts) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(SERVICE_CHANNEL, texts.serviceChannel, NotificationManager.IMPORTANCE_LOW)
        .apply { setShowBadge(false) },
    )
    // The ringtone and the vibration are played here, so they follow the app's ringtone and the
    // phone's ringer mode; the channel itself makes no sound.
    manager.createNotificationChannel(
      NotificationChannel(CALL_CHANNEL, texts.callChannel, NotificationManager.IMPORTANCE_HIGH)
        .apply {
          setSound(null, null)
          enableVibration(false)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        },
    )
    manager.createNotificationChannel(
      NotificationChannel(MISSED_CHANNEL, texts.missedChannel, NotificationManager.IMPORTANCE_DEFAULT)
        .apply {
          setSound(null, null)
          enableVibration(false)
        },
    )
  }

  /** A call the stream delivered (status `received`, not taken by another device). */
  fun incoming(context: Context, config: CallConfig, event: JSONObject) {
    val id = event.optString("id").ifEmpty { return }
    if (AppState.foreground) return
    val texts = config.texts
    val caller = callerOf(event, config.e2eKey, texts)
    val received = receivedAt(event)
    val at = Calendar.getInstance().apply { timeInMillis = received }
    val allowed = try {
      isRingAllowed(JSONArray(config.modes), at)
    } catch (e: Exception) {
      true
    } && System.currentTimeMillis() - received <= RING_WINDOW_MS
    main.post {
      if (AppState.foreground || ringing.containsKey(id) || missed.contains(id)) return@post
      if (!allowed) {
        showMissed(context, id, caller, texts)
        return@post
      }
      ringing[id] = caller
      notify(context, id, CALL_NOTIFICATION, callNotification(context, id, caller, texts))
      startRinging(context, config)
      HandlerCompat.postDelayed(main, { timedOut(context, id, texts) }, id, RING_TIMEOUT_MS)
    }
  }

  /** Another device answered or ended the call `id`: it stops ringing here. */
  fun ended(context: Context, id: String) {
    main.post {
      main.removeCallbacksAndMessages(id)
      if (ringing.remove(id) != null) cancel(context, id, CALL_NOTIFICATION)
      if (missed.remove(id)) cancel(context, id, MISSED_NOTIFICATION)
      if (ringing.isEmpty()) stopRinging()
    }
  }

  /** The page is on screen: it rings and lists the calls itself, so every notification goes. */
  fun appShown(context: Context) {
    main.post {
      for (id in ringing.keys) {
        main.removeCallbacksAndMessages(id)
        cancel(context, id, CALL_NOTIFICATION)
      }
      for (id in missed) cancel(context, id, MISSED_NOTIFICATION)
      ringing.clear()
      missed.clear()
      stopRinging()
    }
  }

  private fun timedOut(context: Context, id: String, texts: Texts) {
    val caller = ringing.remove(id) ?: return
    cancel(context, id, CALL_NOTIFICATION)
    if (ringing.isEmpty()) stopRinging()
    showMissed(context, id, caller, texts)
  }

  private fun showMissed(context: Context, id: String, caller: Caller, texts: Texts) {
    missed.add(id)
    val notification = NotificationCompat.Builder(context, MISSED_CHANNEL)
      .setSmallIcon(R.drawable.outbrief_call_notification)
      .setContentTitle("${texts.missedTitle} · ${caller.name}")
      .setContentText(caller.subtitle)
      .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
      .setContentIntent(openApp(context, id))
      .setAutoCancel(true)
      .build()
    notify(context, id, MISSED_NOTIFICATION, notification)
  }

  private fun callNotification(context: Context, id: String, caller: Caller, texts: Texts): Notification {
    val open = openApp(context, id)
    return NotificationCompat.Builder(context, CALL_CHANNEL)
      .setSmallIcon(R.drawable.outbrief_call_notification)
      .setContentTitle(caller.name)
      .setContentText(caller.subtitle)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(open)
      // Over the lock screen it opens the app's incoming-call screen at once; while the phone is in
      // use it shows as a heads-up notification.
      .setFullScreenIntent(open, true)
      .addAction(0, texts.answer, open)
      .setOngoing(true)
      .setAutoCancel(true)
      // No setSilent(): AndroidX silences through a group that only its summary alerts, and the
      // system then drops the full-screen intent. The channel makes no sound already.
      .build()
  }

  /** Opens the app; the page shows the call. */
  private fun openApp(context: Context, id: String): PendingIntent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent().setPackage(context.packageName)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    intent.putExtra(EXTRA_CALL, id)
    return PendingIntent.getActivity(
      context,
      id.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun notify(context: Context, id: String, kind: Int, notification: Notification) {
    try {
      context.getSystemService(NotificationManager::class.java).notify(id, kind, notification)
    } catch (e: SecurityException) {
      // Notifications are off for the app: the page says so (设置 → 后台来电).
      Log.w(TAG, "notification not allowed", e)
    }
  }

  private fun cancel(context: Context, id: String, kind: Int) {
    context.getSystemService(NotificationManager::class.java).cancel(id, kind)
  }

  /** Rings like a phone: the ringtone in normal mode, vibration in vibrate mode, silent otherwise. */
  private fun startRinging(context: Context, config: CallConfig) {
    if (player != null || vibrating != null) return
    val audio = context.getSystemService(AudioManager::class.java)
    when (audio.ringerMode) {
      AudioManager.RINGER_MODE_NORMAL -> player = play(context, config)
      AudioManager.RINGER_MODE_VIBRATE -> vibrating = vibrate(context)
      else -> {}
    }
  }

  private fun play(context: Context, config: CallConfig): MediaPlayer? {
    val file = File(context.filesDir, RINGTONE_FILE)
    return try {
      MediaPlayer().apply {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        // The app's incoming ringtone once the page handed it over; the phone's until then.
        if (file.isFile && config.ringtoneId.isNotEmpty()) setDataSource(file.path)
        else setDataSource(context, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
        isLooping = true
        setWakeMode(context, PowerManager.PARTIAL_WAKE_LOCK)
        prepare()
        start()
      }
    } catch (e: Exception) {
      Log.w(TAG, "ringtone", e)
      null
    }
  }

  @Suppress("DEPRECATION")
  private fun vibrate(context: Context): Vibrator? {
    val vibrator = context.getSystemService(Vibrator::class.java) ?: return null
    val pattern = longArrayOf(0, 1000, 1000)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0))
    } else {
      vibrator.vibrate(pattern, 0)
    }
    return vibrator
  }

  private fun stopRinging() {
    player?.let {
      try {
        it.stop()
      } catch (e: IllegalStateException) {
        // never started
      }
      it.release()
    }
    player = null
    vibrating?.cancel()
    vibrating = null
  }

  /** When the server received the call: the modes on then decide whether it rings (OUTB-58). */
  private fun receivedAt(event: JSONObject): Long {
    val text = event.optString("receivedAt")
    for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX")) {
      try {
        return SimpleDateFormat(pattern, Locale.ROOT).parse(text)!!.time
      } catch (e: Exception) {
        // try the next form
      }
    }
    return System.currentTimeMillis()
  }
}
