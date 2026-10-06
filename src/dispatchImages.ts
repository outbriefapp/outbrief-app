import type { DispatchImage } from "./protocol.ts";

/**
 * Largest image: Multica's own upload limit (`MAX_FILE_SIZE` in its web app, `maxUploadSize` on its
 * server, 100 MB); mirrors outbrief-daemon `MAX_DISPATCH_IMAGE_BYTES`. Like Multica, there is no
 * limit on how many images a dispatch carries (YOUT-226).
 */
export const MAX_DISPATCH_IMAGE_BYTES = 100 * 1024 * 1024;
/** Images up to this size (and `MAX_EDGE`) are sent as they are: screenshots stay sharp. */
const KEEP_BYTES = 1.5 * 1024 * 1024;
/** Longest side of a shrunk image: enough to read a screenshot's text. */
const MAX_EDGE = 2048;
/** Formats every agent can open as they are; others (HEIC…) are re-encoded. */
const KEPT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** An image picked for a dispatch, ready to send. */
export interface PickedImage extends DispatchImage {
  /** For React keys and removal. */
  id: string;
  /** `blob:` URL of the thumbnail; revoke with `releaseImage`. */
  previewUrl: string;
}

/** The file is not an image, cannot be decoded, or is over Multica's 100 MB. */
export class ImageRejectedError extends Error {
  override name = "ImageRejectedError";
  readonly reason: "not_image" | "unreadable" | "too_big";

  constructor(reason: ImageRejectedError["reason"]) {
    super(reason);
    this.reason = reason;
  }
}

/** Whether a picked file must be re-encoded before it is sent. */
export function needsShrink(file: { type: string; size: number }, width: number, height: number) {
  return !KEPT_TYPES.has(file.type) || file.size > KEEP_BYTES || Math.max(width, height) > MAX_EDGE;
}

/** `width` × `height` scaled down so the longest side is at most `maxEdge`. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** `photo.HEIC` → `photo.jpg`. */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "image";
  return `${base}.jpg`;
}

/**
 * Turns a picked / pasted / dropped file into an image to send: small screenshots go as they are;
 * big photos and formats not every agent opens are re-encoded as JPEG with the longest side at most
 * `MAX_EDGE`.
 */
export async function pickImage(file: File): Promise<PickedImage> {
  if (!file.type.startsWith("image/")) throw new ImageRejectedError("not_image");
  // Checked on the file as picked, as Multica does.
  if (file.size > MAX_DISPATCH_IMAGE_BYTES) throw new ImageRejectedError("too_big");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageRejectedError("unreadable");
  }
  let blob: Blob = file;
  let name = file.name || "image.png";
  try {
    if (needsShrink(file, bitmap.width, bitmap.height)) {
      blob = await toJpeg(bitmap);
      name = jpegName(name);
    }
  } finally {
    bitmap.close();
  }
  if (blob.size > MAX_DISPATCH_IMAGE_BYTES) throw new ImageRejectedError("too_big");
  return {
    id: crypto.randomUUID(),
    name,
    type: blob.type,
    data: await base64Of(blob),
    previewUrl: URL.createObjectURL(blob),
  };
}

export function releaseImage(image: PickedImage): void {
  URL.revokeObjectURL(image.previewUrl);
}

/** What the daemon gets: the image without its thumbnail. */
export function toDispatchImage({ name, type, data }: PickedImage): DispatchImage {
  return { name, type, data };
}

async function toJpeg(bitmap: ImageBitmap): Promise<Blob> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) throw new ImageRejectedError("unreadable");
  // JPEG has no transparency: a transparent screenshot gets a white background, not a black one.
  g.fillStyle = "#fff";
  g.fillRect(0, 0, width, height);
  g.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) throw new ImageRejectedError("unreadable");
  return blob;
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
