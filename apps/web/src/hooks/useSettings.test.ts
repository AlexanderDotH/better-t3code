import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import { mergeEnvironmentSettings } from "./useSettings";

describe("mergeEnvironmentSettings", () => {
  it("combines the selected environment's server settings with client preferences", () => {
    const serverSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("codex_remote")]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
        },
      },
    };
    const clientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      favorites: [
        {
          provider: ProviderInstanceId.make("codex_remote"),
          model: "gpt-5.4",
        },
      ],
    };

    const settings = mergeEnvironmentSettings(serverSettings, clientSettings);

    expect(settings.providerInstances).toBe(serverSettings.providerInstances);
    expect(settings.favorites).toBe(clientSettings.favorites);
  });

  it("fills default provider settings when persisted server settings only contain provider instances", () => {
    const hyperagentId = ProviderInstanceId.make("hyperagent");
    const settings = mergeEnvironmentSettings(
      {
        providerInstances: {
          [hyperagentId]: {
            driver: ProviderDriverKind.make("hyperagent"),
            enabled: true,
          },
        },
      },
      DEFAULT_CLIENT_SETTINGS,
    );

    expect(settings.providers.codex.enabled).toBe(true);
    expect(settings.providers.claudeAgent.enabled).toBe(true);
    expect(settings.providerInstances[hyperagentId]?.enabled).toBe(true);
  });
});
