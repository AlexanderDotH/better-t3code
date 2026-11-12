import { MAX_SNOOZE_PRESETS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";
import { parseSnoozePresets, snoozePresetDraft } from "./snooze-presets-settings";

describe("mobile snooze preset drafts", () => {
  it("round-trips both kinds and preserves the edited order", () => {
    const presets = [
      { kind: "after", minutes: 43200 },
      { kind: "at", day: "monday", time: "00:00" },
    ] as const;
    expect(parseSnoozePresets(presets.map(snoozePresetDraft))).toEqual(presets);
    expect(parseSnoozePresets(presets.toReversed().map(snoozePresetDraft))).toEqual(
      presets.toReversed(),
    );
    expect(parseSnoozePresets([])).toEqual([]);
  });

  it("rejects invalid durations, times and excessive preset lists", () => {
    const after = snoozePresetDraft({ kind: "after", minutes: 60 }, 0);
    for (const minutes of ["", "0", "1.5", "1e2", "10min", "43201"])
      expect(parseSnoozePresets([{ ...after, minutes }])).toBeNull();
    const at = snoozePresetDraft({ kind: "at", day: "today", time: "09:00" }, 1);
    for (const time of ["9:00", "24:00", "12:60", ""])
      expect(parseSnoozePresets([{ ...at, time }])).toBeNull();
    expect(
      parseSnoozePresets(Array.from({ length: MAX_SNOOZE_PRESETS + 1 }, () => after)),
    ).toBeNull();
  });
});
