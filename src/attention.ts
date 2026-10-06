import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

/** Brings the app window forward when a call starts ringing (no-op in a plain browser). */
export async function requestCallAttention(): Promise<void> {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  await win.unminimize();
  await win.show();
  await win.setFocus();
  await win.requestUserAttention(UserAttentionType.Critical);
}
