/** Minimal text/event-stream parser (fetch-based, so requests can carry an Authorization header). */
export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

export class SseParser {
  #buf = "";

  /** Feeds a decoded chunk; returns frames completed by it. */
  push(chunk: string): SseFrame[] {
    this.#buf += chunk.replace(/\r\n?/g, "\n");
    const frames: SseFrame[] = [];
    let idx = this.#buf.indexOf("\n\n");
    while (idx >= 0) {
      const frame = parseFrame(this.#buf.slice(0, idx));
      if (frame) frames.push(frame);
      this.#buf = this.#buf.slice(idx + 2);
      idx = this.#buf.indexOf("\n\n");
    }
    return frames;
  }
}

function parseFrame(block: string): SseFrame | null {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  if (data.length === 0) return null;
  return id === undefined ? { event, data: data.join("\n") } : { event, data: data.join("\n"), id };
}
