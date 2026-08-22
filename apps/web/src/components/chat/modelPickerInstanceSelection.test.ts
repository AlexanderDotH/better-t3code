import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveInitialModelPickerInstance } from "./modelPickerInstanceSelection";

const CODEX = ProviderInstanceId.make("codex");
const CLAUDE = ProviderInstanceId.make("claudeAgent");

describe("resolveInitialModelPickerInstance", () => {
  it("opens the globally remembered provider instead of favorites in an unlocked chat", () => {
    expect(
      resolveInitialModelPickerInstance({
        activeInstanceId: CODEX,
        preferredInstanceId: CLAUDE,
        selectableInstanceIds: new Set([CODEX, CLAUDE]),
        isLocked: false,
        hasFavorites: true,
      }),
    ).toBe(CLAUDE);
  });

  it("falls back to favorites when the remembered provider is no longer selectable", () => {
    expect(
      resolveInitialModelPickerInstance({
        activeInstanceId: CODEX,
        preferredInstanceId: CLAUDE,
        selectableInstanceIds: new Set([CODEX]),
        isLocked: false,
        hasFavorites: true,
      }),
    ).toBe("favorites");
  });

  it("keeps a locked thread on its active provider", () => {
    expect(
      resolveInitialModelPickerInstance({
        activeInstanceId: CODEX,
        preferredInstanceId: CLAUDE,
        selectableInstanceIds: new Set([CODEX, CLAUDE]),
        isLocked: true,
        hasFavorites: true,
      }),
    ).toBe(CODEX);
  });
});
