package ai.outbrief.callservice

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Keeps this device's event stream (`/v1/stream`) open while 设置 → 后台来电 is on, under a
 * persistent notification, so calls ring with the page in the background, the phone locked, or the
 * app swiped away (OUTB-60). The webview is paused there, and its own stream with it.
 *
 * Like the page it reconnects with exponential backoff and resumes after the last sequence it saw,
 * so a call that arrived while offline still rings once back online; the server pings every 25 s,
 * so a connection silent for longer than `READ_TIMEOUT_MS` is dead and replaced.
 */
class CallService : Service() {
  private lateinit var config: CallConfig
  @Volatile private var running = false
  @Volatile private var connection: HttpURLConnection? = null
  private var worker: Thread? = null
  private val lock = Object()
  private var networkCallback: ConnectivityManager.NetworkCallback? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    config = CallConfig(this)
    CallAlerts.createChannels(this, config.texts)
    goForeground()
    watchNetwork()
    // Re-created by the system after it killed the process (the app swiped away, memory), the
    // service is not always handed the null-intent start a sticky service is promised: follow the
    // stream from here too, or calls stay silent until the app is opened again (OUTB-62).
    if (config.enabled) follow()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!config.enabled) {
      stopSelf()
      return START_NOT_STICKY
    }
    // The texts may have changed language; the server or token may have changed.
    CallAlerts.createChannels(this, config.texts)
    goForeground()
    if (intent?.action == ACTION_RECONNECT) reconnect()
    follow()
    return START_STICKY
  }

  /** Starts following the stream unless it is followed already. */
  private fun follow() {
    if (worker?.isAlive == true) return
    running = true
    worker = Thread(::followLoop, "outbrief-stream").apply { start() }
  }

  override fun onDestroy() {
    running = false
    reconnect()
    networkCallback?.let {
      getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it)
    }
    super.onDestroy()
  }

  private fun goForeground() {
    val texts = config.texts
    val notification: Notification = NotificationCompat.Builder(this, CallAlerts.SERVICE_CHANNEL)
      .setSmallIcon(R.drawable.outbrief_call_notification)
      .setContentTitle(texts.serviceTitle)
      .setContentText(texts.serviceText)
      .setOngoing(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(
        packageManager.getLaunchIntentForPackage(packageName)?.let {
          android.app.PendingIntent.getActivity(this, 0, it, android.app.PendingIntent.FLAG_IMMUTABLE)
        },
      )
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        CallAlerts.SERVICE_NOTIFICATION,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(CallAlerts.SERVICE_NOTIFICATION, notification)
    }
  }

  /** Back on a network: reconnect now rather than after the backoff; a lost one is dead at once. */
  private fun watchNetwork() {
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = wake()
      override fun onLost(network: Network) = reconnect()
    }
    getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(callback)
    networkCallback = callback
  }

  /** Drops the current connection (the loop opens a new one) and ends any backoff wait. */
  private fun reconnect() {
    connection?.disconnect()
    wake()
  }

  private fun wake() {
    synchronized(lock) { lock.notifyAll() }
  }

  private fun followLoop() {
    var backoff = MIN_BACKOFF_MS
    while (running) {
      try {
        if (config.lastSeq < 0) config.lastSeq = latestPendingSeq()
        when (stream()) {
          StreamEnd.UNAUTHORIZED -> {
            // This device was removed from its account: the page asks to join again.
            Log.w(TAG, "the server no longer knows this device")
            running = false
            stopSelf()
            return
          }
          StreamEnd.CLOSED -> backoff = MIN_BACKOFF_MS
        }
      } catch (e: Exception) {
        if (!running) return
        Log.w(TAG, "stream: ${e.message}")
      }
      synchronized(lock) { if (running) lock.wait(backoff) }
      backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
    }
  }

  private enum class StreamEnd { CLOSED, UNAUTHORIZED }

  private fun open(path: String, stream: Boolean): HttpURLConnection {
    val conn = URL(config.serverUrl + path).openConnection() as HttpURLConnection
    conn.connectTimeout = CONNECT_TIMEOUT_MS
    conn.readTimeout = if (stream) READ_TIMEOUT_MS else CONNECT_TIMEOUT_MS
    conn.setRequestProperty("Authorization", "Bearer ${config.token}")
    if (stream) {
      conn.setRequestProperty("Accept", "text/event-stream")
      conn.setRequestProperty("Last-Event-ID", config.lastSeq.toString())
    }
    return conn
  }

  /**
   * The newest call still waiting for this device when the service first connects for an account:
   * those already rang in the app (or were missed there), so only later ones ring here.
   */
  private fun latestPendingSeq(): Long {
    var after = 0L
    while (true) {
      val conn = open("/v1/events?after=$after", false)
      try {
        if (conn.responseCode != 200) throw IllegalStateException("events HTTP ${conn.responseCode}")
        val body = conn.inputStream.bufferedReader().use { it.readText() }
        val events = JSONObject(body).optJSONArray("events")
        if (events == null || events.length() == 0) return after
        after = events.getJSONObject(events.length() - 1).optLong("seq", after)
      } finally {
        conn.disconnect()
      }
    }
  }

  private fun stream(): StreamEnd {
    val conn = open("/v1/stream", true)
    connection = conn
    try {
      val code = conn.responseCode
      if (code == 401) return StreamEnd.UNAUTHORIZED
      if (code != 200) throw IllegalStateException("stream HTTP $code")
      connected = true
      val reader = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8))
      var event = "message"
      val data = StringBuilder()
      while (running) {
        val line = reader.readLine() ?: return StreamEnd.CLOSED
        when {
          line.isEmpty() -> {
            if (data.isNotEmpty()) frame(event, data.toString())
            event = "message"
            data.setLength(0)
          }
          line.startsWith(":") -> {}
          else -> {
            val colon = line.indexOf(':')
            val field = if (colon < 0) line else line.substring(0, colon)
            var value = if (colon < 0) "" else line.substring(colon + 1)
            if (value.startsWith(" ")) value = value.substring(1)
            when (field) {
              "event" -> event = value
              "data" -> {
                if (data.isNotEmpty()) data.append('\n')
                data.append(value)
              }
            }
          }
        }
      }
      return StreamEnd.CLOSED
    } finally {
      connected = false
      connection = null
      conn.disconnect()
    }
  }

  private fun frame(event: String, data: String) {
    if (event != STREAM_EVENT && event != CALL_STATUS_EVENT) return
    // The phone may be dozing: stay awake long enough to show the call.
    val wakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "outbrief:call")
    wakeLock.acquire(10_000)
    try {
      val relayed = JSONObject(data)
      if (event == CALL_STATUS_EVENT) {
        CallAlerts.ended(this, relayed.optString("id"))
        return
      }
      val seq = relayed.optLong("seq", 0)
      if (seq > config.lastSeq) config.lastSeq = seq
      if (relayed.optString("status") == "received" && !relayed.has("handledBy")) {
        CallAlerts.incoming(this, config, relayed)
      }
    } catch (e: Exception) {
      Log.w(TAG, "event: ${e.message}")
    } finally {
      wakeLock.release()
    }
  }

  companion object {
    private const val TAG = "OutBriefStream"
    private const val ACTION_RECONNECT = "ai.outbrief.callservice.RECONNECT"
    /** `STREAM_EVENT_NAME` and `CALL_STATUS_EVENT_NAME` of src/protocol.ts. */
    private const val STREAM_EVENT = "agent-event"
    private const val CALL_STATUS_EVENT = "call-status"
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 70_000
    private const val MIN_BACKOFF_MS = 1_000L
    private const val MAX_BACKOFF_MS = 30_000L

    /**
     * The service's stream is open: calls reach this device even while the page's own stream, paused
     * in the background, reconnects after the app comes back on screen.
     */
    @Volatile var connected = false
      private set

    /**
     * Starts or stops the service after the page changed what it should follow; `reconnect`: the
     * server or the token changed.
     */
    fun sync(context: Context, reconnect: Boolean) {
      val intent = Intent(context, CallService::class.java)
      if (CallConfig(context).enabled) {
        if (reconnect) intent.action = ACTION_RECONNECT
        ContextCompat.startForegroundService(context, intent)
      } else {
        context.stopService(intent)
      }
    }
  }
}
