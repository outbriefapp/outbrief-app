package ai.outbrief.callservice

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Whether a call may ring at `at` with the modes that are on: the same rule as the page's
 * `isRingAllowed` (src/callModes.ts). Each day follows the mode used on it; a day without one
 * always rings. `ringOnly` rings inside its ranges only, `quiet` never rings inside them; a range
 * whose end is before its start crosses midnight.
 */
fun isRingAllowed(modes: JSONArray, at: Calendar): Boolean {
  // Calendar counts Sunday as 1, the page (Date.getDay) as 0.
  val day = at.get(Calendar.DAY_OF_WEEK) - 1
  val mode = (0 until modes.length())
    .mapNotNull { modes.optJSONObject(it) }
    .firstOrNull { m -> m.optJSONArray("days")?.let { days -> (0 until days.length()).any { days.optInt(it, -1) == day } } == true }
    ?: return true
  val minute = at.get(Calendar.HOUR_OF_DAY) * 60 + at.get(Calendar.MINUTE)
  val ranges = mode.optJSONArray("ranges") ?: JSONArray()
  val inside = (0 until ranges.length()).mapNotNull { ranges.optJSONObject(it) }.any { r ->
    val start = minutes(r.optString("start"))
    val end = minutes(r.optString("end"))
    if (start == null || end == null) false
    else if (start < end) minute in start until end
    else minute >= start || minute < end
  }
  return if (mode.optString("rule") == "ringOnly") inside else !inside
}

private fun minutes(time: String): Int? {
  val parts = time.split(":")
  if (parts.size != 2) return null
  val h = parts[0].toIntOrNull() ?: return null
  val m = parts[1].toIntOrNull() ?: return null
  return h * 60 + m
}

/** Who is calling and about what, as the incoming-call screen names it (src/format.ts). */
data class Caller(val name: String, val subtitle: String)

private val SOURCE_LABEL = mapOf(
  "claude-code" to "Claude Code",
  "codex" to "Codex",
  "gemini-cli" to "Gemini CLI",
  "multica" to "Multica Agent",
)

private const val REPORT_AAD = "outbrief:report:v1"

/**
 * The caller of a relayed event: opened with the end-to-end key when there is one (the report is
 * sealed), otherwise only what the server can see.
 */
fun callerOf(event: JSONObject, e2eKey: String, texts: Texts): Caller {
  val report = event.optString("sealed", "").takeIf { it.isNotEmpty() && e2eKey.isNotEmpty() }
    ?.let { openReport(e2eKey, it) }
  val multica = report?.optJSONObject("multica")
  if (multica != null) {
    return Caller(
      multica.optString("agentName", "").ifEmpty { SOURCE_LABEL.getValue("multica") },
      "${multica.optString("issueIdentifier")} ${multica.optString("issueTitle")}".trim(),
    )
  }
  val source = event.optString("source", "generic")
  val name = SOURCE_LABEL[source] ?: texts.genericSource
  val subtitle = report?.optString("title", "")?.ifEmpty { null }
    ?: report?.optString("cwd", "")?.ifEmpty { null }
    ?: event.optJSONObject("machine")?.optString("name", "")?.ifEmpty { null }
    ?: texts.taskReport
  return Caller(name, subtitle)
}

/**
 * `ob1.<keyId>.<iv>.<ciphertext>`: AES-256-GCM with the report AAD (src/e2e/crypto.ts). Null when
 * it cannot be opened (another key, damaged): the call still rings, without its title.
 */
fun openReport(e2eKey: String, sealed: String): JSONObject? = try {
  val parts = sealed.split(".")
  if (parts.size != 4 || parts[0] != "ob1") null
  else {
    val flags = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
    val key = Base64.decode(e2eKey, flags)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.DECRYPT_MODE,
      SecretKeySpec(key, "AES"),
      GCMParameterSpec(128, Base64.decode(parts[2], flags)),
    )
    cipher.updateAAD(REPORT_AAD.toByteArray(Charsets.UTF_8))
    JSONObject(String(cipher.doFinal(Base64.decode(parts[3], flags)), Charsets.UTF_8))
  }
} catch (e: Exception) {
  null
}
