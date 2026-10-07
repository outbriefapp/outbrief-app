import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { CallMode } from "./callModes.ts";
import type { E2eKey } from "./e2e/crypto.ts";
import { toBase64Url } from "./e2e/crypto.ts";
import { type Messages, useT } from "./i18n/index.ts";
import { loadRingtoneAudio } from "./ringtoneStore.ts";
import { builtinRingtone } from "./ringtones.ts";
import type { ServerSettings } from "./serverClient.ts";

/**
 * The Android app's background call service (OUTB-60, `src-tauri/plugins/call-service`): while
 * the page is not on screen the system pauses the webview and its event stream, so a foreground
 * service follows the stream natively and rings calls as full-screen notifications. The page hands
 * it what it needs here: the server and token, the end-to-end key (for the caller's name), the
 * modes that are on (calls outside their ringing time do not ring) and the incoming ringtone.
 */

/** The Android app, the only place the service exists. */
export function isAndroidApp(): boolean {
  return isTauri() && /Android/i.test(navigator.userAgent);
}

export type NotificationPermission = "granted" | "denied" | "prompt";

/** What the system lets the service do. */
export interface CallServiceStatus {
  notifications: NotificationPermission;
  /** May show the incoming call over the lock screen (Android 14+ can revoke it). */
  fullScreen: boolean;
  /** Exempt from battery optimization: the system is less likely to stop the service. */
  unrestricted: boolean;
}

export type SettingsTarget = "notifications" | "fullScreen" | "battery";

/** Texts the service shows, in the UI language. */
function serviceTexts(msg: Messages): Record<string, string> {
  const m = msg.callService;
  return {
    serviceChannel: m.serviceChannel,
    serviceTitle: m.serviceTitle,
    serviceText: m.serviceText,
    callChannel: m.callChannel,
    missedChannel: m.missedChannel,
    missedTitle: m.missedTitle,
    answer: m.answer,
    genericSource: msg.event.genericSource,
    taskReport: msg.event.taskReport,
  };
}

export function getCallServiceStatus(): Promise<CallServiceStatus> {
  return invoke<CallServiceStatus>("plugin:call-service|get_status");
}

/** Asks for the notification permission (a no-op once answered); resolves the status after. */
export function requestNotifications(): Promise<CallServiceStatus> {
  return invoke<CallServiceStatus>("plugin:call-service|request_notifications");
}

export function openSystemSettings(target: SettingsTarget): Promise<void> {
  return invoke("plugin:call-service|open_settings", { target });
}

async function base64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(",") + 1);
}

/** The audio of the ringtone `id`: a file of the app, or the user's own tone from IndexedDB. */
async function ringtoneAudio(id: string): Promise<Blob> {
  const builtin = builtinRingtone(id);
  if (!builtin) return loadRingtoneAudio(id);
  const resp = await fetch(builtin.file);
  if (!resp.ok) throw new Error(`ringtone ${id}: HTTP ${resp.status}`);
  return resp.blob();
}

/**
 * Keeps the service in step with the page (Android only): on while `enabled` and this device is in
 * an account, off otherwise.
 */
export function useCallService(options: {
  enabled: boolean;
  server: ServerSettings | null;
  e2eKey: E2eKey | null;
  modes: CallMode[];
  ringtoneId: string;
}): void {
  const { enabled, server, e2eKey, modes, ringtoneId } = options;
  const msg = useT();
  useEffect(() => {
    if (!isAndroidApp()) return;
    let cancelled = false;
    const config = {
      enabled: enabled && !!server,
      serverUrl: server?.serverUrl ?? "",
      token: server?.token ?? "",
      e2eKey: e2eKey ? toBase64Url(e2eKey.raw) : "",
      modes,
      ringtoneId,
      texts: serviceTexts(msg),
    };
    invoke<{ ringtoneId: string }>("plugin:call-service|configure", config)
      .then(async (current) => {
        if (cancelled || !config.enabled || current.ringtoneId === ringtoneId) return;
        const audio = await base64(await ringtoneAudio(ringtoneId));
        if (cancelled) return;
        await invoke("plugin:call-service|set_ringtone", { id: ringtoneId, audio });
      })
      .catch((err: unknown) => console.warn("[outbrief] call service", err));
    return () => {
      cancelled = true;
    };
  }, [enabled, server, e2eKey, modes, ringtoneId, msg]);
}

/** Set once the app asked for notifications by itself, so it asks only once. */
const ASKED_KEY = "outbrief.notificationsAsked";

/**
 * What the system lets the service do (null outside the Android app, or until read), re-read
 * whenever the page comes back on screen (e.g. from the system settings). Once this device is in an
 * account it asks for notifications by itself, once.
 */
export function useCallServiceStatus(inAccount: boolean): {
  status: CallServiceStatus | null;
  request: () => void;
  open: (target: SettingsTarget) => void;
} {
  const [status, setStatus] = useState<CallServiceStatus | null>(null);
  const android = isAndroidApp();
  const refresh = useCallback(() => {
    getCallServiceStatus().then(setStatus, (err: unknown) =>
      console.warn("[outbrief] call service status", err),
    );
  }, []);
  useEffect(() => {
    if (!android) return;
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [android, refresh]);
  useEffect(() => {
    if (!inAccount || status?.notifications !== "prompt" || localStorage.getItem(ASKED_KEY)) return;
    localStorage.setItem(ASKED_KEY, "1");
    requestNotifications().then(setStatus, (err: unknown) =>
      console.warn("[outbrief] notifications", err),
    );
  }, [inAccount, status?.notifications]);
  const open = useCallback(
    (target: SettingsTarget) => {
      openSystemSettings(target).catch((err: unknown) =>
        console.warn("[outbrief] open settings", err),
      );
      refresh();
    },
    [refresh],
  );
  // Refused before: only the system settings can turn them on now.
  const request = useCallback(() => {
    if (status?.notifications !== "prompt") return open("notifications");
    requestNotifications().then(setStatus, (err: unknown) =>
      console.warn("[outbrief] notifications", err),
    );
  }, [status?.notifications, open]);
  return { status, request, open };
}

/** Whether the page is on screen; a paused Android webview reports hidden. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
