import { describe, expect, it } from "vitest";
import {
  fitWithin,
  ImageRejectedError,
  jpegName,
  needsShrink,
  pickImage,
} from "./dispatchImages.ts";

describe("dispatch images", () => {
  it("sends small screenshots as they are", () => {
    expect(needsShrink({ type: "image/png", size: 400_000 }, 1440, 900)).toBe(false);
    expect(needsShrink({ type: "image/jpeg", size: 1_500_000 }, 2048, 1536)).toBe(false);
  });

  it("shrinks big photos, huge screens and formats agents may not open", () => {
    expect(needsShrink({ type: "image/jpeg", size: 4_000_000 }, 1600, 1200)).toBe(true);
    expect(needsShrink({ type: "image/png", size: 900_000 }, 5120, 2880)).toBe(true);
    expect(needsShrink({ type: "image/heic", size: 300_000 }, 1200, 900)).toBe(true);
  });

  it("keeps the aspect ratio and never enlarges", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(1170, 2532)).toEqual({ width: 946, height: 2048 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("names a re-encoded image .jpg", () => {
    expect(jpegName("IMG_0001.HEIC")).toBe("IMG_0001.jpg");
    expect(jpegName("截图 2026-09-30.png")).toBe("截图 2026-09-30.jpg");
    expect(jpegName("noext")).toBe("noext.jpg");
    expect(jpegName(".png")).toBe("image.jpg");
  });

  it("refuses what Multica would refuse: an image over 100 MB, or not an image", async () => {
    const file = (type: string, size: number) => ({ type, size, name: "x" }) as unknown as File;
    await expect(pickImage(file("image/png", 100 * 1024 * 1024 + 1))).rejects.toEqual(
      new ImageRejectedError("too_big"),
    );
    await expect(pickImage(file("application/pdf", 10))).rejects.toMatchObject({
      reason: "not_image",
    });
  });
});
