import { ADDRESS_PLACEHOLDER, type AgentEvent } from "./protocol.ts";

/**
 * The event with the brief's `{称呼}` placeholders replaced by the user's own 称呼, so every text
 * shown or spoken (speech, cards, decisions) uses it. Events without a brief pass through.
 */
export function personalizeEvent(event: AgentEvent, addressName: string): AgentEvent {
  const brief = event.brief?.brief;
  if (!event.brief || !brief) return event;
  // Replace inside the JSON text: covers every string field, escaping the name as JSON.
  const escaped = JSON.stringify(addressName).slice(1, -1);
  const json = JSON.stringify(brief);
  if (!json.includes(ADDRESS_PLACEHOLDER)) return event;
  return {
    ...event,
    brief: { ...event.brief, brief: JSON.parse(json.replaceAll(ADDRESS_PLACEHOLDER, escaped)) },
  };
}
