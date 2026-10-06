import { DAEMON_URL } from "./daemonLink.ts";
import { errorMessage } from "./format.ts";
import { t } from "./i18n/index.ts";
import type { MulticaStatus } from "./protocol.ts";
import { ServerError } from "./serverClient.ts";

/** One line for the saved connection: connected, still connecting, or what went wrong. */
export function multicaStatusText(status: MulticaStatus): string {
  const m = t();
  if (!status.configured) return m.common.notSet;
  if (status.error) return status.error;
  return status.connected ? m.multica.connected : m.multica.connecting;
}

/** The daemon's Multica error codes in words; anything else keeps its message. */
export function multicaErrorText(err: unknown): string {
  if (err instanceof ServerError) {
    const m = t().multica;
    // A relayed machine that is offline says so itself; the local daemon may just not be running.
    if (err.status === null)
      return err.code === "machine_offline" ? err.message : m.daemonDown(DAEMON_URL);
    switch (err.code) {
      case "invalid_multica_token":
        return m.invalidToken;
      case "workspace_not_found":
        return m.workspaceNotFound;
      case "multica_not_configured":
        return m.notConfigured;
      case "multica_failed":
        return m.failed(err.message);
    }
  }
  return errorMessage(err);
}
