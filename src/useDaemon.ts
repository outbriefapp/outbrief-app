import { useEffect, useMemo, useState } from "react";
import { type DaemonLink, readLocalDaemonKey } from "./daemonLink.ts";
import type { E2eKey } from "./e2e/crypto.ts";
import type { Device } from "./protocol.ts";
import { listDevices, type ServerSettings } from "./serverClient.ts";

/** How often the account's computers are re-read for their online state (relay only). */
const DEVICES_REFRESH_MS = 60_000;

/**
 * The local daemon's key: undefined while it is read, null when there is none (a browser, a
 * phone, or no daemon ever ran on this machine).
 */
export function useLocalDaemonKey(): string | null | undefined {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    readLocalDaemonKey().then(
      (value) => !cancelled && setKey(value),
      (err: unknown) => {
        console.warn("[outbrief] read the local daemon key", err);
        if (!cancelled) setKey(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return key;
}

/**
 * Which daemon this device changes settings on (Multica, brief LLM, brief language):
 *
 * - the one on this machine when there is one (desktop app);
 * - otherwise one of the account's computers through the server: the one picked in 设置 → 设备
 *   (`daemonId`), else the first online one, else the first one.
 *
 * `daemons` lists the account's computers for the picker (relay only).
 */
export function useDaemonLink(options: {
  localKey: string | null | undefined;
  server: ServerSettings | null;
  e2eKey: E2eKey | null;
  daemonId: string | null;
}): { link: DaemonLink | null; daemons: Device[] } {
  const { localKey, server, e2eKey, daemonId } = options;
  const [daemons, setDaemons] = useState<Device[]>([]);
  const relay = !localKey && localKey !== undefined && !!server;

  useEffect(() => {
    if (!relay || !server) {
      setDaemons([]);
      return;
    }
    const ctrl = new AbortController();
    const load = () =>
      listDevices(server, ctrl.signal).then(
        (devices) => !ctrl.signal.aborted && setDaemons(devices.filter((d) => d.kind === "daemon")),
        (err: unknown) => !ctrl.signal.aborted && console.warn("[outbrief] list devices", err),
      );
    void load();
    const timer = setInterval(load, DEVICES_REFRESH_MS);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [relay, server]);

  const machine = useMemo(
    () =>
      daemons.find((d) => d.id === daemonId) ?? daemons.find((d) => d.online) ?? daemons[0] ?? null,
    [daemons, daemonId],
  );
  const machineId = machine?.id;
  const machineName = machine?.name;

  const link = useMemo<DaemonLink | null>(() => {
    if (localKey) return { kind: "local", localKey };
    if (!server || !e2eKey || !machineId || !machineName) return null;
    return { kind: "relay", server, machine: { id: machineId, name: machineName }, key: e2eKey };
  }, [localKey, server, e2eKey, machineId, machineName]);

  return { link, daemons };
}
