import {
  LM_STUDIO_BASE_URL,
  ProviderDriverKind,
  ProviderInstanceId,
  type AiEndpointCandidate,
  type ExecutionEnvironmentCapabilities,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  adoptMobileAiEndpointDraft,
  isMobileAiEndpointConfigured,
  mobileAiEndpointDraft,
  mobileAiEndpointDraftWithBaseUrl,
  mobileAiEndpointSettingsPatch,
  removeMobileAiEndpointSettingsPatch,
  supportsMobileAiEndpointDiscovery,
} from "./mobile-ai-endpoint-settings";

const candidate: AiEndpointCandidate = {
  kind: "lmstudio",
  baseUrl: LM_STUDIO_BASE_URL,
  models: [{ id: "local-coder", name: "Local Coder" }],
  verified: true,
  requiresApiKey: false,
};
const instanceId = ProviderInstanceId.make("lmstudio_work");

describe("mobile AI endpoint setup", () => {
  it("starts the two provider entries with independent URL defaults", () => {
    expect(mobileAiEndpointDraft("openaiCompatible")).toMatchObject({
      driver: "openaiCompatible",
      baseUrl: "",
      apiKey: "",
    });
    expect(mobileAiEndpointDraft("lmstudio")).toMatchObject({
      driver: "lmstudio",
      baseUrl: LM_STUDIO_BASE_URL,
      apiKey: "",
    });
  });

  it("allows saving a connection before fetching its default model and excludes credentials", () => {
    const patch = mobileAiEndpointSettingsPatch({
      settings: { providerInstances: {} },
      instanceId,
      draft: {
        ...mobileAiEndpointDraft("openaiCompatible"),
        baseUrl: " https://models.example:443/ ",
        apiKey: "secret-key",
      },
    });
    expect(patch.providerInstances?.[instanceId]).toEqual({
      driver: "openaiCompatible",
      enabled: true,
      displayName: "OpenAI Compatible",
      config: { baseUrl: "https://models.example/v1", defaultModel: "", customModels: [] },
    });
    expect(JSON.stringify(patch)).not.toContain("secret-key");
  });

  it("preserves other instances, metadata, proxy paths and manual models when editing", () => {
    const otherInstanceId = ProviderInstanceId.make("lmstudio_home");
    const settings: Pick<ServerSettings, "providerInstances"> = {
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("lmstudio"),
          enabled: false,
          displayName: "Work",
          accentColor: "#123456",
          config: { baseUrl: LM_STUDIO_BASE_URL, defaultModel: "previous" },
        },
        [otherInstanceId]: { driver: ProviderDriverKind.make("lmstudio"), enabled: true },
      },
    };
    const patch = mobileAiEndpointSettingsPatch({
      settings,
      instanceId,
      draft: {
        ...mobileAiEndpointDraft("lmstudio", settings.providerInstances[instanceId]),
        displayName: " Office ",
        baseUrl: "https://models.example/proxy/api/",
        defaultModel: " manual/coder ",
        customModels: ["manual/vision", " manual/vision ", "", " manual/coder "],
      },
    });
    expect(patch.providerInstances?.[instanceId]).toEqual({
      driver: "lmstudio",
      enabled: false,
      displayName: "Office",
      accentColor: "#123456",
      config: {
        baseUrl: "https://models.example/proxy/api",
        defaultModel: "manual/coder",
        customModels: ["manual/vision", "manual/coder"],
      },
    });
    expect(patch.providerInstances?.[otherInstanceId]).toEqual(
      settings.providerInstances[otherInstanceId],
    );
    expect(settings.providerInstances[instanceId]?.displayName).toBe("Work");
  });

  it("rejects missing URLs, unsupported protocols and embedded credentials before saving", () => {
    for (const baseUrl of ["", "file:///tmp/models", "https://user:password@models.example"]) {
      expect(() =>
        mobileAiEndpointSettingsPatch({
          settings: { providerInstances: {} },
          instanceId,
          draft: { ...mobileAiEndpointDraft("openaiCompatible"), baseUrl },
        }),
      ).toThrow();
    }
  });

  it("clears a drafted key on URL changes and adopts discovery without losing existing choices", () => {
    const draft = {
      ...mobileAiEndpointDraft("openaiCompatible"),
      displayName: "Office",
      baseUrl: "https://models.example/v1",
      apiKey: "private-key",
      defaultModel: "manual-coder",
      customModels: ["manual-vision"],
    };
    expect(mobileAiEndpointDraftWithBaseUrl(draft, draft.baseUrl).apiKey).toBe("private-key");
    expect(mobileAiEndpointDraftWithBaseUrl(draft, LM_STUDIO_BASE_URL).apiKey).toBe("");
    expect(adoptMobileAiEndpointDraft(draft, candidate, true)).toEqual({
      ...draft,
      baseUrl: LM_STUDIO_BASE_URL,
      apiKey: "",
    });
    expect(
      adoptMobileAiEndpointDraft(mobileAiEndpointDraft("openaiCompatible"), candidate, false),
    ).toMatchObject({
      driver: "lmstudio",
      baseUrl: LM_STUDIO_BASE_URL,
      defaultModel: "local-coder",
    });
  });

  it("marks default LM Studio and normalized configured URLs while ignoring other drivers", () => {
    expect(
      isMobileAiEndpointConfigured(
        {
          providerInstances: { [instanceId]: { driver: ProviderDriverKind.make("lmstudio") } },
        },
        candidate,
      ),
    ).toBe(true);
    expect(
      isMobileAiEndpointConfigured(
        {
          providerInstances: {
            [ProviderInstanceId.make("compatible")]: {
              driver: ProviderDriverKind.make("openaiCompatible"),
              config: { baseUrl: "http://127.0.0.1:1234/" },
            },
          },
        },
        candidate,
      ),
    ).toBe(true);
    expect(
      isMobileAiEndpointConfigured(
        {
          providerInstances: {
            [ProviderInstanceId.make("unrelated")]: {
              driver: ProviderDriverKind.make("openrouter"),
              config: { baseUrl: LM_STUDIO_BASE_URL },
            },
            [ProviderInstanceId.make("invalid")]: {
              driver: ProviderDriverKind.make("lmstudio"),
              config: { baseUrl: "invalid" },
            },
          },
        },
        candidate,
      ),
    ).toBe(false);
  });

  it("removes just the selected instance and refuses discovery on old or read-only servers", () => {
    const otherInstanceId = ProviderInstanceId.make("other");
    const settings = {
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("lmstudio") },
        [otherInstanceId]: { driver: ProviderDriverKind.make("openaiCompatible") },
      },
    };
    expect(removeMobileAiEndpointSettingsPatch(settings, instanceId)).toEqual({
      providerInstances: { [otherInstanceId]: settings.providerInstances[otherInstanceId] },
    });
    expect(settings.providerInstances[instanceId]).toBeDefined();
    const capabilities: ExecutionEnvironmentCapabilities = {
      repositoryIdentity: true,
      midChatProviderSwitching: true,
      aiEndpointDiscovery: true,
    };
    expect(supportsMobileAiEndpointDiscovery(capabilities, false)).toBe(true);
    expect(supportsMobileAiEndpointDiscovery(capabilities, true)).toBe(false);
    expect(supportsMobileAiEndpointDiscovery(undefined, false)).toBe(false);
    expect(
      supportsMobileAiEndpointDiscovery({ ...capabilities, aiEndpointDiscovery: false }, false),
    ).toBe(false);
  });
});
