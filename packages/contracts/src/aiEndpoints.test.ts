import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  AiEndpointDiscoveryEvent,
  LM_STUDIO_BASE_URL,
  LmStudioSettings,
  normalizeAiEndpointBaseUrl,
  OpenAiCompatibleSettings,
} from "./aiEndpoints.ts";
import { ExecutionEnvironmentCapabilities } from "./environment.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import {
  defaultEnabledForDriver,
  resolveProviderInstanceEnabled,
  ServerSettings,
} from "./settings.ts";

const decodeOpenAiCompatibleSettings = Schema.decodeUnknownSync(OpenAiCompatibleSettings);
const decodeLmStudioSettings = Schema.decodeUnknownSync(LmStudioSettings);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeDiscoveryEvent = Schema.decodeUnknownSync(AiEndpointDiscoveryEvent);
const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);

describe("AI endpoint configuration", () => {
  it("normalizes origins without changing proxy paths", () => {
    expect(normalizeAiEndpointBaseUrl("  ")).toBe("");
    expect(normalizeAiEndpointBaseUrl(" http://LOCALHOST:1234/ ")).toBe(
      LM_STUDIO_BASE_URL.replace("127.0.0.1", "localhost"),
    );
    expect(normalizeAiEndpointBaseUrl("http://[::1]:1234")).toBe("http://[::1]:1234/v1");
    expect(normalizeAiEndpointBaseUrl("https://example.test/proxy/")).toBe(
      "https://example.test/proxy",
    );
    expect(normalizeAiEndpointBaseUrl("https://example.test/proxy/v1///")).toBe(
      "https://example.test/proxy/v1",
    );
    expect(normalizeAiEndpointBaseUrl("https://example.test/team%20one/openai")).toBe(
      "https://example.test/team%20one/openai",
    );
  });

  it.each([
    "not a URL",
    "file:///tmp/model",
    "ftp://example.test/v1",
    "https://user:secret@example.test/v1",
    "https://user@example.test/v1",
    "https://:secret@example.test/v1",
    "https://example.test:65536/v1",
    "https://example.test/v1?key=secret",
    "https://example.test/v1?",
    "https://example.test/v1#section",
    "https://example.test/v1#",
  ])("rejects unsafe or non-HTTP base URL %s", (baseUrl) => {
    expect(() => normalizeAiEndpointBaseUrl(baseUrl)).toThrow();
    expect(() => decodeOpenAiCompatibleSettings({ baseUrl })).toThrow();
  });

  it("keeps endpoints disabled by default and supports manual model IDs in instance config", () => {
    expect(decodeOpenAiCompatibleSettings({})).toEqual({
      enabled: false,
      baseUrl: "",
      defaultModel: "",
      customModels: [],
    });
    expect(decodeLmStudioSettings({})).toMatchObject({
      enabled: false,
      baseUrl: LM_STUDIO_BASE_URL,
    });
    expect(decodeLmStudioSettings({ baseUrl: "" }).baseUrl).toBe("");

    for (const driverId of ["openaiCompatible", "lmstudio"]) {
      const driver = ProviderDriverKind.make(driverId);
      const instanceId = ProviderInstanceId.make(`${driverId}-custom`);
      const config = {
        baseUrl: LM_STUDIO_BASE_URL,
        defaultModel: "org/manual-model",
        customModels: ["org/other-model"],
      };
      expect(defaultEnabledForDriver(driver)).toBe(false);
      expect(resolveProviderInstanceEnabled({ driver, config })).toBe(false);
      const settings = decodeServerSettings({
        providerInstances: { [instanceId]: { driver, config } },
      });
      expect(settings.providerInstances[instanceId]?.config).toEqual(config);
      expect(Object.hasOwn(settings.providers, driver)).toBe(false);
    }
  });

  it("validates incremental discovery events", () => {
    const event = {
      status: "complete",
      endpoints: [
        {
          baseUrl: LM_STUDIO_BASE_URL,
          kind: "lmstudio",
          verified: true,
          requiresApiKey: false,
          models: [{ id: "local-model" }],
        },
      ],
      scanned: 3,
      total: 3,
      limited: false,
    };
    expect(decodeDiscoveryEvent(event)).toEqual(event);
    expect(() => decodeDiscoveryEvent({ ...event, scanned: -1 })).toThrow();
  });

  it("leaves discovery unsupported for old servers and preserves an explicit capability", () => {
    expect(decodeCapabilities({}).aiEndpointDiscovery).toBeUndefined();
    expect(decodeCapabilities({ aiEndpointDiscovery: false }).aiEndpointDiscovery).toBe(false);
    expect(decodeCapabilities({ aiEndpointDiscovery: true }).aiEndpointDiscovery).toBe(true);
    expect(() => decodeCapabilities({ aiEndpointDiscovery: "true" })).toThrow();
  });
});
