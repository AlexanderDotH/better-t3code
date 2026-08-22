import { describe, expect, it } from "vite-plus/test";

import settingsPanelsSource from "./SettingsPanels.tsx?raw";

describe("Appearance expanded chat controls setting", () => {
  it("wires the searchable switch to the persisted setting and its default", () => {
    const modelReasoningIndex = settingsPanelsSource.indexOf(
      'searchableSetting("model-reasoning")',
    );
    const expandedControlsIndex = settingsPanelsSource.indexOf(
      'searchableSetting("expanded-chat-controls")',
    );
    const environmentIdentificationIndex = settingsPanelsSource.indexOf(
      'searchableSetting("environment-identification")',
    );

    expect(modelReasoningIndex).toBeGreaterThan(-1);
    expect(expandedControlsIndex).toBeGreaterThan(modelReasoningIndex);
    expect(environmentIdentificationIndex).toBeGreaterThan(expandedControlsIndex);

    const settingSource = settingsPanelsSource.slice(
      expandedControlsIndex,
      environmentIdentificationIndex,
    );

    expect(settingSource).toContain(
      "Show separate provider, context, mode, and access controls in the chat composer when space permits. Narrow chats continue to use the controls menu.",
    );
    expect(settingSource).toMatch(
      /settings\.showExpandedComposerControls\s*!==\s*DEFAULT_UNIFIED_SETTINGS\.showExpandedComposerControls/,
    );
    expect(settingSource).toMatch(
      /updateSettings\(\{\s*showExpandedComposerControls:\s*DEFAULT_UNIFIED_SETTINGS\.showExpandedComposerControls,?\s*\}\)/,
    );
    expect(settingSource).toContain("checked={settings.showExpandedComposerControls}");
    expect(settingSource).toContain(
      "updateSettings({ showExpandedComposerControls: Boolean(checked) })",
    );
    expect(settingSource).toContain('aria-label="Show expanded chat controls"');
  });
});

describe("Appearance chat visuals setting", () => {
  it("wires the synchronized mode and status to the dedicated setting row", () => {
    const appearanceStart = settingsPanelsSource.indexOf(
      "export function AppearanceSettingsPanel()",
    );
    const appearanceEnd = settingsPanelsSource.indexOf(
      "function useFontDefaultFamilies()",
      appearanceStart,
    );
    const appearanceSource = settingsPanelsSource.slice(appearanceStart, appearanceEnd);

    expect(appearanceStart).toBeGreaterThan(-1);
    expect(appearanceEnd).toBeGreaterThan(appearanceStart);
    expect(appearanceSource).toContain("useChatVisualMode()");
    expect(appearanceSource).toContain("useSetChatVisualMode()");
    expect(appearanceSource).toContain("useChatVisualModeSyncStatus()");
    expect(appearanceSource).toContain("chatVisualModeSyncStatusText(chatVisualModeSyncStatus)");
    expect(appearanceSource).toContain(
      'chatVisualModeSyncStatus.isSyncing ? "Syncing with connected servers…" : null',
    );
    expect(appearanceSource).toContain("<ChatVisualModeSetting\n          mode={chatVisualMode}");
    expect(appearanceSource).toContain("onChange={setChatVisualMode}");
    expect(appearanceSource).toContain("status={chatVisualModeStatusText}");
  });
});
