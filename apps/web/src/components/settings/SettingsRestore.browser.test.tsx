import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { useSettingsRestore } from "./SettingsPanels";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  previewCount: 3,
  update: vi.fn(),
  setPreviewCount: vi.fn(),
}));

vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings) as never,
  useUpdateScopedSettings: (() => state.update) as never,
}));
vi.mock(import("../../projectThreadPreviewSync"), async (original) => ({
  ...(await original()),
  useProjectThreadPreviewCount: () => ({
    count: state.previewCount,
    setCount: state.setPreviewCount,
  }),
}));
vi.mock(import("../../hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: (() => ({
    theme: "system",
    followSystem: true,
    themeHalves: null,
    setTheme: () => true,
    setFollowSystem: () => true,
    setThemeHalf: () => true,
    clearThemeHalves: () => true,
  })) as never,
  readThemePreference: () => "system",
  readThemeHalves: () => null,
  readAppearanceModePreference: () => "system",
}));
vi.mock(import("../../confirmDialog"), async (original) => ({
  ...(await original()),
  requestConfirmDialog: async () => true,
}));

function RestoreControls() {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore();
  return (
    <>
      <output>{changedSettingLabels.join(", ")}</output>
      <button type="button" onClick={restoreDefaults}>
        Restore defaults
      </button>
    </>
  );
}

it("restores custom width, response metrics and the synchronized thread preview preference", async () => {
  state.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    chatWidthCustomizationEnabled: true,
    chatWidthAdjustmentPercent: 70,
    responseMetricsEnabled: true,
  };
  state.previewCount = 1;
  state.update = vi.fn();
  state.setPreviewCount = vi.fn();
  await using screen = await render(<RestoreControls />);

  const summary = screen.container.querySelector("output")!.textContent;
  expect(summary).toContain("Chat width");
  expect(summary).toContain("Response details");
  expect(summary).toContain("Visible threads");
  await screen.getByRole("button", { name: "Restore defaults" }).click();
  await vi.waitFor(() =>
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({
        chatWidthCustomizationEnabled: DEFAULT_UNIFIED_SETTINGS.chatWidthCustomizationEnabled,
        chatWidthAdjustmentPercent: DEFAULT_UNIFIED_SETTINGS.chatWidthAdjustmentPercent,
        responseMetricsEnabled: DEFAULT_UNIFIED_SETTINGS.responseMetricsEnabled,
        sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount,
      }),
    ),
  );
  expect(state.setPreviewCount).toHaveBeenCalledWith(
    DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount,
  );
});
