import { isTauri } from "@tauri-apps/api/core";

/**
 * Pairing links: what the "添加设备" QR code holds (outbrief-server ADR 0008). The end-to-end key
 * rides along from device to device; the server only ever sees the 6-digit code. outbrief-daemon
 * `src/pairing.ts` reads and writes the same format.
 */
export const PAIRING_LINK_PREFIX = "outbrief://pair";

export interface PairingInvite {
  code: string;
  /** Absent when only the 6 digits were typed. */
  serverUrl?: string;
  /** `obk1_…`; absent when only the 6 digits were typed. */
  key?: string;
}

export function pairingLink(invite: Required<PairingInvite>): string {
  const params = new URLSearchParams({
    server: invite.serverUrl,
    code: invite.code,
    key: invite.key,
  });
  return `${PAIRING_LINK_PREFIX}?${params}`;
}

/** A pasted / scanned pairing link or 6 typed digits (spaces allowed); undefined otherwise. */
export function parsePairingInput(text: string): PairingInvite | undefined {
  const trimmed = text.trim();
  const digits = trimmed.replace(/\s/g, "");
  if (/^\d{6}$/.test(digits)) return { code: digits };
  if (!trimmed.startsWith(PAIRING_LINK_PREFIX)) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  const code = url.searchParams.get("code") ?? "";
  const serverUrl = url.searchParams.get("server") ?? "";
  const key = url.searchParams.get("key") ?? "";
  if (!/^\d{6}$/.test(code) || !/^https?:\/\//.test(serverUrl)) return undefined;
  return { code, serverUrl, ...(key ? { key } : {}) };
}

/** "123 456": how a code is shown. */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/**
 * How this device appears in the account's device list: the platform, and whether it is the
 * desktop app or a browser.
 */
export function deviceName(userAgent: string = navigator.userAgent, tauri = isTauri()): string {
  const platform = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "";
  const kind = tauri ? "App" : "Browser";
  return platform ? `${platform} ${kind}` : kind;
}
