import { DEFAULT_SERVER_SETTINGS, McpServerId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mapSettingsSecrets } from "./settingsSecrets.ts";

describe("settings credential compatibility", () => {
  it("retains existing AssemblyAI and MCP credential-store keys", () => {
    const names: string[] = [];
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      speechTranscription: {
        ...DEFAULT_SERVER_SETTINGS.speechTranscription,
        assemblyAi: {
          ...DEFAULT_SERVER_SETTINGS.speechTranscription.assemblyAi,
          apiKey: { value: "voice-key", valueRedacted: false },
        },
      },
      mcp: {
        ...DEFAULT_SERVER_SETTINGS.mcp,
        servers: [
          {
            id: McpServerId.make("local"),
            name: "Local",
            enabled: true,
            providerRouting: { mode: "all" as const },
            scope: "global" as const,
            transport: "stdio" as const,
            command: "mcp",
            args: [],
            env: { TOKEN: { value: "mcp-key", sensitive: true } },
          },
        ],
      },
    };
    mapSettingsSecrets(settings, (secret) => {
      if (secret.value.length > 0) names.push(secret.secretName);
      return secret;
    });
    expect(names).toContain("speech-transcription-assembly-ai-api-key");
    expect(names).toContain("mcp-env-bG9jYWw-VE9LRU4");
  });
});
