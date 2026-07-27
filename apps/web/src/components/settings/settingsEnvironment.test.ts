import { EnvironmentId, type EnvironmentApi } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { requireSettingsEnvironment, resolveSettingsEnvironmentId } from "./settingsEnvironment";

const primaryEnvironmentId = EnvironmentId.make("environment-primary");
const selectedEnvironmentId = EnvironmentId.make("environment-selected");

describe("settings environment routing", () => {
  it("uses the selected project environment instead of the primary environment", async () => {
    vi.stubGlobal("window", {});
    const primaryChatDiscover = vi.fn();
    const primarySkillList = vi.fn();
    const primaryMcpStatus = vi.fn();
    const selectedChatDiscover = vi.fn().mockResolvedValue({ sources: [] });
    const selectedSkillList = vi.fn().mockResolvedValue({ skills: [] });
    const selectedMcpStatus = vi.fn().mockResolvedValue({ providers: [] });
    __setEnvironmentApiOverrideForTests(primaryEnvironmentId, {
      chatImport: { discover: primaryChatDiscover },
      skills: { list: primarySkillList },
      mcp: { providerStatus: primaryMcpStatus },
    } as unknown as EnvironmentApi);
    __setEnvironmentApiOverrideForTests(selectedEnvironmentId, {
      chatImport: { discover: selectedChatDiscover },
      skills: { list: selectedSkillList },
      mcp: { providerStatus: selectedMcpStatus },
    } as unknown as EnvironmentApi);

    try {
      const target = requireSettingsEnvironment({
        primaryEnvironmentId,
        selectedEnvironmentId,
      });
      await target.api.chatImport.discover();
      await target.api.skills.list({ includeBody: true });
      await target.api.mcp.providerStatus();

      expect(target.environmentId).toBe(selectedEnvironmentId);
      expect(selectedChatDiscover).toHaveBeenCalledOnce();
      expect(selectedSkillList).toHaveBeenCalledWith({ includeBody: true });
      expect(selectedMcpStatus).toHaveBeenCalledOnce();
      expect(primaryChatDiscover).not.toHaveBeenCalled();
      expect(primarySkillList).not.toHaveBeenCalled();
      expect(primaryMcpStatus).not.toHaveBeenCalled();
    } finally {
      __resetEnvironmentApiOverridesForTests();
      vi.unstubAllGlobals();
    }
  });

  it("falls back to the primary environment when no project environment is selected", () => {
    expect(
      resolveSettingsEnvironmentId({
        primaryEnvironmentId,
        selectedEnvironmentId: null,
      }),
    ).toBe(primaryEnvironmentId);
  });

  it("returns null when neither a selected nor primary environment is available", () => {
    expect(
      resolveSettingsEnvironmentId({
        primaryEnvironmentId: null,
        selectedEnvironmentId: null,
      }),
    ).toBeNull();
  });
});
