package ai.outbrief.callservice

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * The calls the service heard of while the page was paused, kept for the page (OUTB-63). A call
 * another device answered or ended is gone from the server by the time the page is back on screen
 * (its ciphertext is erased, and its status is pushed live only), so without these the page could
 * never say in its history where it was answered.
 *
 * Each entry is `{ id, event?, status? }`: `event` the relayed call as the stream sent it (still
 * sealed), `status` the latest `{ status, handledBy }` another device reported. The page takes them
 * all at once (`take`); the oldest are dropped past `MAX_ENTRIES` or `MAX_AGE_MS`.
 */
object CallInbox {
  private const val PREFS = "outbrief.call-service.inbox"
  private const val ENTRIES = "entries"
  private const val MAX_ENTRIES = 100
  private const val MAX_AGE_MS = 24L * 60 * 60 * 1000

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** A call the stream delivered. */
  @Synchronized
  fun arrived(context: Context, relayed: JSONObject) {
    val id = relayed.optString("id")
    if (id.isEmpty()) return
    update(context, id) { it.put("event", relayed) }
  }

  /** Another device answered or ended the call `id` (`call-status`, without its ciphertext). */
  @Synchronized
  fun statusChanged(context: Context, relayed: JSONObject) {
    val id = relayed.optString("id")
    val handledBy = relayed.optJSONObject("handledBy") ?: return
    if (id.isEmpty()) return
    update(context, id) {
      it.put("status", JSONObject().put("status", relayed.optString("status")).put("handledBy", handledBy))
    }
  }

  /** Every entry, oldest first; the inbox is empty afterwards. */
  @Synchronized
  fun take(context: Context): JSONArray {
    val entries = load(context)
    prefs(context).edit().remove(ENTRIES).apply()
    val out = JSONArray()
    for (entry in entries) out.put(entry.apply { remove("at") })
    return out
  }

  /** Clears the inbox: a new account, whose calls are not this one's. */
  @Synchronized
  fun clear(context: Context) {
    prefs(context).edit().remove(ENTRIES).apply()
  }

  private fun update(context: Context, id: String, change: (JSONObject) -> Unit) {
    val now = System.currentTimeMillis()
    val entries = load(context).filter { now - it.optLong("at") < MAX_AGE_MS }.toMutableList()
    val entry = entries.firstOrNull { it.optString("id") == id }
      ?: JSONObject().put("id", id).also { entries.add(it) }
    change(entry)
    entry.put("at", now)
    val kept = entries.takeLast(MAX_ENTRIES)
    prefs(context).edit().putString(ENTRIES, JSONArray(kept).toString()).apply()
  }

  private fun load(context: Context): List<JSONObject> {
    val raw = prefs(context).getString(ENTRIES, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      (0 until array.length()).mapNotNull { array.optJSONObject(it) }
    } catch (e: Exception) {
      emptyList()
    }
  }
}
