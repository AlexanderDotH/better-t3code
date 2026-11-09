import { describe, expect, it } from "vite-plus/test";

import { resolveComposerControlsOwnership } from "./composerControlsOwnership";
import { shouldUseCompactComposerControls } from "../composerFooterLayout";

const base = {
  matchesDefault: true,
  collapsed: false,
  measuredHiddenBlockCount: 0,
};

describe("resolveComposerControlsOwnership", () => {
  it("moves secondary controls into overflow when expanded controls are disabled", () => {
    const ownership = (
      expandedControlsEnabled: boolean,
      inContextStrip = false,
      hasContextWindowControl = false,
    ) =>
      resolveComposerControlsOwnership({
        ...base,
        matchesDefault: false,
        hasContextWindowControl,
        compact: shouldUseCompactComposerControls({
          expandedControlsEnabled,
          inContextStrip,
        }),
      });
    expect(ownership(false)).toMatchObject({ hiddenBlockIds: ["mode"] });
    expect(ownership(false, false, true)).toMatchObject({
      hiddenBlockIds: ["context", "mode"],
      hiddenBlockCount: 2,
    });
    expect(ownership(true)).toMatchObject({ hiddenBlockIds: [] });
    expect(ownership(true, false, true)).toMatchObject({ hiddenBlockIds: [] });
    expect(ownership(false, true)).toMatchObject({ hiddenBlockIds: [] });
    expect(ownership(false, true, true)).toMatchObject({ hiddenBlockIds: [] });
    expect(
      resolveComposerControlsOwnership({
        ...base,
        layout: "classic",
        hasTraitsControl: true,
        hasContextWindowControl: true,
        compact: true,
      }),
    ).toMatchObject({
      accessDisplay: "label",
      hiddenBlockIds: ["traits", "mode"],
      hiddenBlockCount: 2,
      pickerOwnsModeShortcut: false,
    });
  });

  it("hides the chip at the default and lets the model picker answer composer.mode", () => {
    const result = resolveComposerControlsOwnership(base);
    expect(result).toMatchObject({
      accessDisplay: "hidden",
      hiddenBlockIds: [],
      pickerOwnsModeShortcut: true,
    });
    expect(resolveComposerControlsOwnership({ ...base, layout: "classic" })).toMatchObject({
      accessDisplay: "label",
      hiddenBlockIds: [],
      pickerOwnsModeShortcut: false,
    });
  });

  it("shows a labelled chip that owns composer.mode when the mode differs", () => {
    const result = resolveComposerControlsOwnership({ ...base, matchesDefault: false });
    expect(result).toMatchObject({
      accessDisplay: "label",
      pickerOwnsModeShortcut: false,
    });
  });

  it("leaves Permissions with the picker when the mode block overflows", () => {
    const result = resolveComposerControlsOwnership({
      ...base,
      matchesDefault: false,
      measuredHiddenBlockCount: 1,
    });
    expect(result.hiddenBlockIds).toEqual(["mode"]);
    expect(result.pickerOwnsModeShortcut).toBe(true);
    expect(
      resolveComposerControlsOwnership({
        ...base,
        hasContextWindowControl: true,
        measuredHiddenBlockCount: 1,
      }).hiddenBlockIds,
    ).toEqual(["mode"]);
    expect(
      resolveComposerControlsOwnership({
        ...base,
        hasContextWindowControl: true,
        measuredHiddenBlockCount: 2,
      }).hiddenBlockIds,
    ).toEqual(["context", "mode"]);
  });

  it("shows the non-default chip as an icon in the compacted row", () => {
    const result = resolveComposerControlsOwnership({
      ...base,
      matchesDefault: false,
      collapsed: true,
    });
    expect(result.accessDisplay).toBe("icon");
  });
});
