import { useEffect } from "react";
import { loadRingtoneAudio } from "./ringtoneStore.ts";
import { builtinRingtone, SILENT } from "./ringtones.ts";

/**
 * Plays the ringtone `id` (a built-in id or a custom one from IndexedDB) until it stops; null or
 * `SILENT` plays nothing. `loop: false` plays it once, for a preview.
 */
export function playRingtone(id: string, loop = true): () => void {
  if (id === SILENT) return () => undefined;
  const audio = new Audio();
  audio.loop = loop;
  let objectUrl: string | null = null;
  let stopped = false;
  const start = (src: string) => {
    if (stopped) return;
    audio.src = src;
    audio.play().catch((err: unknown) => console.warn("[outbrief] ringtone", id, err));
  };
  const builtin = builtinRingtone(id);
  if (builtin) start(builtin.file);
  else {
    loadRingtoneAudio(id).then(
      (blob) => {
        if (stopped) return;
        objectUrl = URL.createObjectURL(blob);
        start(objectUrl);
      },
      (err: unknown) => console.warn("[outbrief] ringtone", id, err),
    );
  }
  return () => {
    stopped = true;
    audio.pause();
    audio.removeAttribute("src");
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}

/** Loops the ringtone `id` while it is not null. */
export function useRingtone(id: string | null): void {
  useEffect(() => (id ? playRingtone(id) : undefined), [id]);
}
