import { SnoozePresetSettings, type SnoozePresetSetting } from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";

const isSnoozePresetSettings = Schema.is(SnoozePresetSettings);

export interface SnoozePresetDraft {
  readonly key: number;
  readonly when: "after" | Extract<SnoozePresetSetting, { kind: "at" }>["day"];
  readonly minutes: string;
  readonly time: string;
}

export function snoozePresetDraft(preset: SnoozePresetSetting, key: number): SnoozePresetDraft {
  return {
    key,
    when: preset.kind === "after" ? "after" : preset.day,
    minutes: preset.kind === "after" ? String(preset.minutes) : "60",
    time: preset.kind === "at" ? preset.time : "09:00",
  };
}

export function parseSnoozePresets(rows: readonly SnoozePresetDraft[]) {
  const presets = rows.map((row) =>
    row.when === "after"
      ? {
          kind: "after" as const,
          minutes: /^\d+$/.test(row.minutes) ? Number(row.minutes) : Number.NaN,
        }
      : { kind: "at" as const, day: row.when, time: row.time },
  );
  return isSnoozePresetSettings(presets) ? presets : null;
}
