import { isTauri } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n/index.ts";

/**
 * A yes/no question before a destructive action. The Tauri webview shows no `window.confirm`
 * (it answers false at once, so the action silently never happens); inside Tauri the native
 * dialog asks instead. In the browser (`pnpm dev`) the plain confirm is used.
 */
export function confirmAction(message: string): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(window.confirm(message));
  const { common } = t();
  return ask(message, { kind: "warning", okLabel: common.confirm, cancelLabel: common.cancel });
}
