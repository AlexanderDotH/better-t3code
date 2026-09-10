import {
  LM_STUDIO_BASE_URL,
  normalizeAiEndpointBaseUrl,
  ProviderDriverKind,
  type AiEndpointCandidate,
  type ExecutionEnvironmentCapabilities,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  readProviderConfigString,
  readProviderConfigStringArray,
} from "@t3tools/client-runtime/providerSettingsForm";

export const MOBILE_AI_ENDPOINT_LABELS = {
  openaiCompatible: "OpenAI Compatible",
  lmstudio: "LM Studio",
} as const;

export type MobileAiEndpointKind = keyof typeof MOBILE_AI_ENDPOINT_LABELS;

export function isMobileAiEndpointKind(driver: string): driver is MobileAiEndpointKind {
  return driver === "openaiCompatible" || driver === "lmstudio";
}

export interface MobileAiEndpointDraft {
  readonly driver: MobileAiEndpointKind;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly customModels: ReadonlyArray<string>;
}

export function mobileAiEndpointDraft(
  driver: MobileAiEndpointKind,
  instance?: ProviderInstanceConfig,
): MobileAiEndpointDraft {
  return {
    driver,
    displayName: instance?.displayName ?? "",
    baseUrl: readProviderConfigString(
      instance?.config,
      "baseUrl",
      driver === "lmstudio" ? LM_STUDIO_BASE_URL : "",
    ),
    apiKey: "",
    defaultModel: readProviderConfigString(instance?.config, "defaultModel"),
    customModels: readProviderConfigStringArray(instance?.config, "customModels"),
  };
}

export function mobileAiEndpointSettingsPatch(input: {
  readonly settings: Pick<ServerSettings, "providerInstances">;
  readonly instanceId: ProviderInstanceId;
  readonly draft: MobileAiEndpointDraft;
}): ServerSettingsPatch {
  const baseUrl = normalizeAiEndpointBaseUrl(input.draft.baseUrl);
  if (!baseUrl) throw new Error("Enter the endpoint base URL.");
  const defaultModel = input.draft.defaultModel.trim();
  const existing = input.settings.providerInstances[input.instanceId];
  return {
    providerInstances: {
      ...input.settings.providerInstances,
      [input.instanceId]: {
        ...existing,
        driver: ProviderDriverKind.make(input.draft.driver),
        enabled: existing?.enabled ?? true,
        displayName:
          input.draft.displayName.trim() || MOBILE_AI_ENDPOINT_LABELS[input.draft.driver],
        config: {
          baseUrl,
          defaultModel,
          customModels: [
            ...new Set(input.draft.customModels.map((model) => model.trim()).filter(Boolean)),
          ],
        },
      },
    },
  };
}

export function mobileAiEndpointDraftWithBaseUrl(
  draft: MobileAiEndpointDraft,
  baseUrl: string,
): MobileAiEndpointDraft {
  return { ...draft, baseUrl, apiKey: baseUrl === draft.baseUrl ? draft.apiKey : "" };
}

export function removeMobileAiEndpointSettingsPatch(
  settings: Pick<ServerSettings, "providerInstances">,
  instanceId: ProviderInstanceId,
): ServerSettingsPatch {
  const providerInstances = { ...settings.providerInstances };
  delete providerInstances[instanceId];
  return { providerInstances };
}

export function adoptMobileAiEndpointDraft(
  draft: MobileAiEndpointDraft,
  endpoint: AiEndpointCandidate,
  isExistingInstance: boolean,
): MobileAiEndpointDraft {
  return {
    ...mobileAiEndpointDraftWithBaseUrl(draft, endpoint.baseUrl),
    driver: isExistingInstance ? draft.driver : endpoint.kind,
    defaultModel: draft.defaultModel || endpoint.models[0]?.id || "",
  };
}

export function isMobileAiEndpointConfigured(
  settings: Pick<ServerSettings, "providerInstances">,
  endpoint: AiEndpointCandidate,
): boolean {
  return Object.values(settings.providerInstances).some((instance) => {
    if (!isMobileAiEndpointKind(instance.driver)) return false;
    try {
      return (
        normalizeAiEndpointBaseUrl(mobileAiEndpointDraft(instance.driver, instance).baseUrl) ===
        normalizeAiEndpointBaseUrl(endpoint.baseUrl)
      );
    } catch {
      return false;
    }
  });
}

export function supportsMobileAiEndpointDiscovery(
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
  readOnly: boolean,
): boolean {
  return !readOnly && capabilities?.aiEndpointDiscovery === true;
}
