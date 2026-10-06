import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Messages } from "./i18n/index.ts";

/**
 * Names the app in the current language outside the page: the document and, in the desktop app,
 * the window title, the tray (its tooltip and menu) and the macOS menu bar, whose app menu carries
 * the app's name (启奏 in Chinese). The Rust shell starts with the config's English names until this
 * runs.
 */
export async function localizeShell(msg: Messages): Promise<void> {
  document.title = msg.productName;
  document.documentElement.lang = msg.htmlLang;
  if (!isTauri()) return;
  await invoke("localize_shell", {
    texts: {
      title: msg.productName,
      showWindow: msg.shell.showWindow,
      quit: msg.shell.quit,
      menu: msg.shell.menu,
    },
  });
}
