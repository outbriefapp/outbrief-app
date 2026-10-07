package ai.outbrief.callservice

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * What the page last told the service (`configure`), kept in the app's private preferences so the
 * service works on its own after a reboot or once the page is gone.
 */
class CallConfig(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences("outbrief.call-service", Context.MODE_PRIVATE)

  /** 设置 → 后台来电 is on and this device is in an account. */
  val enabled: Boolean
    get() = prefs.getBoolean(ENABLED, false) && serverUrl.isNotEmpty() && token.isNotEmpty()

  val serverUrl: String
    get() = prefs.getString(SERVER_URL, "") ?: ""

  /** This device's token on the server. */
  val token: String
    get() = prefs.getString(TOKEN, "") ?: ""

  /** The end-to-end key's 32 bytes, base64url; empty: calls ring without their title. */
  val e2eKey: String
    get() = prefs.getString(E2E_KEY, "") ?: ""

  /** The modes that are on, as the page keeps them (`CallMode[]`). */
  val modes: String
    get() = prefs.getString(MODES, "[]") ?: "[]"

  /** The incoming ringtone the service has a copy of (`ringtone` in the app's files). */
  val ringtoneId: String
    get() = prefs.getString(RINGTONE_ID, "") ?: ""

  /** The ringtone the page picked; the copy is updated by `set_ringtone`. */
  val wantedRingtoneId: String
    get() = prefs.getString(WANTED_RINGTONE_ID, "") ?: ""

  /** Texts in the UI language (`Texts`). */
  val texts: Texts
    get() = Texts(JSONObject(prefs.getString(TEXTS, "{}") ?: "{}"))

  /** The last stream sequence the service saw; -1 before it ever connected for this account. */
  var lastSeq: Long
    get() = prefs.getLong(LAST_SEQ, -1)
    set(value) {
      prefs.edit().putLong(LAST_SEQ, value).apply()
    }

  /**
   * Saves what `configure` sent; a new server or token starts the stream from scratch. Returns
   * whether the stream has to reconnect for it.
   */
  fun save(args: JSONObject): Boolean {
    val serverUrl = args.optString("serverUrl", "").trim().trimEnd('/')
    val token = args.optString("token", "").trim()
    val edit = prefs.edit()
    val reconnect = serverUrl != this.serverUrl || token != this.token
    if (reconnect) edit.putLong(LAST_SEQ, -1)
    edit
      .putBoolean(ENABLED, args.optBoolean("enabled", false))
      .putString(SERVER_URL, serverUrl)
      .putString(TOKEN, token)
      .putString(E2E_KEY, args.optString("e2eKey", ""))
      .putString(MODES, args.optJSONArray("modes")?.toString() ?: "[]")
      .putString(WANTED_RINGTONE_ID, args.optString("ringtoneId", ""))
      .putString(TEXTS, args.optJSONObject("texts")?.toString() ?: "{}")
      .apply()
    return reconnect
  }

  fun saveRingtoneId(id: String) {
    prefs.edit().putString(RINGTONE_ID, id).apply()
  }

  private companion object {
    const val ENABLED = "enabled"
    const val SERVER_URL = "serverUrl"
    const val TOKEN = "token"
    const val E2E_KEY = "e2eKey"
    const val MODES = "modes"
    const val RINGTONE_ID = "ringtoneId"
    const val WANTED_RINGTONE_ID = "wantedRingtoneId"
    const val TEXTS = "texts"
    const val LAST_SEQ = "lastSeq"
  }
}

/** What the service shows, in the UI language; Chinese until the page sends its texts. */
class Texts(private val json: JSONObject) {
  private fun text(key: String, fallback: String): String =
    json.optString(key, "").ifEmpty { fallback }

  val serviceChannel get() = text("serviceChannel", "后台接收来电")
  val serviceTitle get() = text("serviceTitle", "OutBrief 正在等待来电")
  val serviceText get() = text("serviceText", "App 在后台或锁屏时也会响铃")
  val callChannel get() = text("callChannel", "来电")
  val missedChannel get() = text("missedChannel", "未接来电")
  val missedTitle get() = text("missedTitle", "未接来电")
  val answer get() = text("answer", "接听")
  val genericSource get() = text("genericSource", "Agent")
  val taskReport get() = text("taskReport", "任务汇报")
}
