import { describe, expect, it } from "vitest";
import {
  CUSTOM_RINGTONE_MAX_BYTES,
  DEFAULT_RINGTONES,
  isRingtoneChoice,
  matchRingtones,
  newestFirst,
  normalizeCustomRingtones,
  normalizeRingtones,
  RINGTONE_NAME_MAX,
  renameCustomRingtone,
  ringtoneFileProblem,
  ringtoneName,
  SILENT,
  usedByOther,
  withoutCustomRingtones,
} from "./ringtones.ts";

const mine = { id: "custom:a", name: "晨光" };

describe("normalizeRingtones", () => {
  it("rings classic for calls and the ringback tone while calling an agent by default", () => {
    expect(normalizeRingtones(undefined, [])).toEqual({
      incoming: "classic",
      dispatch: "ringback",
    });
    expect(DEFAULT_RINGTONES).toEqual({ incoming: "classic", dispatch: "ringback" });
  });

  it("keeps built-in and existing custom choices", () => {
    expect(normalizeRingtones({ incoming: "custom:a", dispatch: "chime" }, [mine])).toEqual({
      incoming: "custom:a",
      dispatch: "chime",
    });
  });

  it("puts removed or unknown tones back to their defaults", () => {
    expect(normalizeRingtones({ incoming: "custom:gone", dispatch: 3 }, [mine])).toEqual(
      DEFAULT_RINGTONES,
    );
  });

  it("lets only the dispatch wait be silent", () => {
    expect(normalizeRingtones({ incoming: SILENT, dispatch: SILENT }, [])).toEqual({
      incoming: "classic",
      dispatch: SILENT,
    });
    expect(isRingtoneChoice("incoming", SILENT, [])).toBe(false);
    expect(isRingtoneChoice("dispatch", SILENT, [])).toBe(true);
  });
});

describe("normalizeCustomRingtones", () => {
  it("drops malformed entries", () => {
    expect(
      normalizeCustomRingtones([mine, { id: "classic", name: "x" }, { id: "custom:b" }, null]),
    ).toEqual([mine]);
    expect(normalizeCustomRingtones("nope")).toEqual([]);
  });
});

describe("withoutCustomRingtones", () => {
  it("returns what used a removed tone to its default", () => {
    expect(
      withoutCustomRingtones({ incoming: "custom:a", dispatch: "custom:b" }, [
        "custom:a",
        "custom:b",
      ]),
    ).toEqual(DEFAULT_RINGTONES);
    expect(
      withoutCustomRingtones({ incoming: "chime", dispatch: "custom:a" }, ["custom:b"]),
    ).toEqual({
      incoming: "chime",
      dispatch: "custom:a",
    });
  });
});

describe("usedByOther", () => {
  it("names the other purpose when it uses the same tone", () => {
    const r = { incoming: "custom:a", dispatch: "custom:a" };
    expect(usedByOther(r, "incoming", "custom:a")).toBe("dispatch");
    expect(usedByOther(r, "dispatch", "custom:a")).toBe("incoming");
    expect(usedByOther({ incoming: "classic", dispatch: "ringback" }, "incoming", "ringback")).toBe(
      "dispatch",
    );
    expect(
      usedByOther({ incoming: "classic", dispatch: "ringback" }, "incoming", "chime"),
    ).toBeNull();
  });
});

describe("matchRingtones", () => {
  const list = [mine, { id: "custom:b", name: "Ocean Waves" }];
  it("filters by name, ignoring case; a blank query keeps all", () => {
    expect(matchRingtones(list, " ocean ")).toEqual([list[1]]);
    expect(matchRingtones(list, "晨")).toEqual([mine]);
    expect(matchRingtones(list, "  ")).toEqual(list);
  });
});

describe("newestFirst", () => {
  it("lists the last added first without changing the saved order", () => {
    const list = [mine, { id: "custom:b", name: "b" }];
    expect(newestFirst(list).map((c) => c.id)).toEqual(["custom:b", "custom:a"]);
    expect(list[0]).toBe(mine);
  });
});

describe("renameCustomRingtone", () => {
  it("renames one tone, trimmed and capped; blank keeps the name", () => {
    const list = [mine, { id: "custom:b", name: "b" }];
    expect(renameCustomRingtone(list, "custom:b", "  海浪 ")[1]).toEqual({
      id: "custom:b",
      name: "海浪",
    });
    expect(renameCustomRingtone(list, "custom:b", "x".repeat(99))[1]?.name).toHaveLength(
      RINGTONE_NAME_MAX,
    );
    expect(renameCustomRingtone(list, "custom:a", "   ")[0]).toEqual(mine);
  });
});

describe("ringtoneFileProblem", () => {
  it("takes audio files up to the size limit", () => {
    expect(ringtoneFileProblem({ type: "audio/mpeg", size: 1000 })).toBeNull();
    expect(ringtoneFileProblem({ type: "image/png", size: 1000 })).toBe("notAudio");
    expect(ringtoneFileProblem({ type: "audio/wav", size: CUSTOM_RINGTONE_MAX_BYTES + 1 })).toBe(
      "tooBig",
    );
  });
});

describe("ringtoneName", () => {
  it("drops the extension", () => {
    expect(ringtoneName("晨光.mp3")).toBe("晨光");
    expect(ringtoneName("a.b.m4a")).toBe("a.b");
    expect(ringtoneName(".mp3")).toBe(".mp3");
  });
});
