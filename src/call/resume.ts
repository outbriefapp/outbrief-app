import type { AgentEvent } from "../protocol.ts";

/** Quotes a shell word with single quotes unless it only holds characters every POSIX shell leaves alone. */
function shellWord(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Terminal command that reopens the agent session a report came from, so the next-step prompt can be
 * pasted straight into it. Null when the agent cannot be resumed (unknown source or no session id).
 */
export function resumeCommand(
  event: Pick<AgentEvent, "source" | "sessionId" | "cwd">,
): string | null {
  if (!event.sessionId) return null;
  let command: string;
  switch (event.source) {
    case "claude-code":
      command = `claude --resume ${shellWord(event.sessionId)}`;
      break;
    case "codex":
      command = `codex resume ${shellWord(event.sessionId)}`;
      break;
    default:
      return null;
  }
  return event.cwd ? `cd ${shellWord(event.cwd)} && ${command}` : command;
}
