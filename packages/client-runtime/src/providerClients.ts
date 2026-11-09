import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  GeminiSettings,
  OpenAiSettings,
  OpenAiCompatibleSettings,
  LmStudioSettings,
  OpenRouterSettings,
  ChatGptSettings,
  isProviderDriverKind,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { acpRegistryClient } from "@t3tools/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@t3tools/provider-core/client";
import { modelShortName } from "@t3tools/provider-core/modelShortName";
import { cursorClient } from "@t3tools/provider-cursor/client";
import { fxClient } from "@t3tools/provider-fx/client";
import { grokClient } from "@t3tools/provider-grok/client";
import { museClient } from "@t3tools/provider-muse/client";
import { openCodeClient } from "@t3tools/provider-opencode/client";
import { piClient } from "@t3tools/provider-pi/client";

import {
  GEMINI_PROVIDER_ICON,
  OPENAI_PROVIDER_ICON,
  OPENROUTER_PROVIDER_ICON,
  SELF_HOSTED_PROVIDER_ICON,
} from "./providerClientIcons.ts";

export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    modelFamilies: ["GPT-", "GPT "],
    acpRegistryAgentIds: ["codex-acp"],
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    modelFamilies: ["Claude "],
    acpRegistryAgentIds: ["claude-acp"],
    settingsSchema: ClaudeSettings,
  },
  {
    driverKind: ProviderDriverKind.make("chatgpt"),
    icon: OPENAI_PROVIDER_ICON,
    label: "ChatGPT Subscription",
    modelFamilies: ["GPT-", "GPT "],
    settingsSchema: ChatGptSettings,
  },
  {
    driverKind: ProviderDriverKind.make("openai"),
    icon: OPENAI_PROVIDER_ICON,
    label: "OpenAI Responses",
    modelFamilies: ["GPT-", "GPT "],
    settingsSchema: OpenAiSettings,
    environmentFields: [{ name: "OPENAI_API_KEY", label: "API key", sensitive: true }],
  },
  {
    driverKind: ProviderDriverKind.make("openrouter"),
    icon: OPENROUTER_PROVIDER_ICON,
    label: "OpenRouter",
    modelFamilies: [],
    settingsSchema: OpenRouterSettings,
    environmentFields: [{ name: "OPENROUTER_API_KEY", label: "API key", sensitive: true }],
  },
  {
    driverKind: ProviderDriverKind.make("openaiCompatible"),
    icon: SELF_HOSTED_PROVIDER_ICON,
    label: "OpenAI Compatible",
    modelFamilies: [],
    settingsSchema: OpenAiCompatibleSettings,
  },
  {
    driverKind: ProviderDriverKind.make("lmstudio"),
    icon: SELF_HOSTED_PROVIDER_ICON,
    label: "LM Studio",
    modelFamilies: [],
    settingsSchema: LmStudioSettings,
  },
  {
    driverKind: ProviderDriverKind.make("gemini"),
    icon: GEMINI_PROVIDER_ICON,
    label: "Gemini",
    modelFamilies: ["Gemini "],
    settingsSchema: GeminiSettings,
    environmentFields: [{ name: "GEMINI_API_KEY", label: "API key", sensitive: true }],
  },
  cursorClient,
  grokClient,
  fxClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    modelFamilies: ["Gemini "],
    acpRegistryAgentIds: ["antigravity-acp"],
    settingsSchema: AntigravitySettings,
  },
  museClient,
  piClient,
  acpRegistryClient,
]);

export function getProviderClient(driver: string | null | undefined) {
  return isProviderDriverKind(driver) ? providerClients.get(driver) : undefined;
}

export function resolveModelShortName(
  model: { readonly name: string; readonly shortName?: string | undefined },
  driverKind: ProviderDriverKind | null | undefined,
): string | undefined {
  if (model.shortName) return model.shortName;
  const families = driverKind ? providerClients.get(driverKind)?.modelFamilies : undefined;
  return modelShortName(model.name, families ?? []);
}
