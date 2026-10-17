import { composerModeToProviderInteractionMode } from "@t3tools/contracts";
import type {
  ComposerMode,
  ExecutionEnvironmentCapabilities,
  ProviderInteractionMode,
  ServerProvider,
} from "@t3tools/contracts";

export * from "./deepPlanningSources.ts";
export * from "./deepPlanningRun.ts";
export * from "./deepPlanningTurn.ts";
export * from "./deepPlanningPresentation.ts";

export function parseDeepPlanComposerCommand(text: string): { readonly prompt: string } | null {
  const prefix = text.match(/^\s*\/deep-plan(?=\s|$)/i);
  return prefix ? { prompt: text.slice(prefix[0].length).trimStart() } : null;
}

export function getNextComposerMode(
  mode: ComposerMode,
  options?: { readonly deepPlanningSupported?: boolean },
): ComposerMode {
  if (mode === "default") return "plan";
  if (mode === "plan" && options?.deepPlanningSupported !== false) return "deep-plan";
  return "default";
}

export const getProviderInteractionMode = composerModeToProviderInteractionMode;

export function resolveComposerMode(
  mode: ComposerMode | null | undefined,
  legacyMode?: ProviderInteractionMode | null,
): ComposerMode {
  return mode ?? legacyMode ?? "default";
}

export interface DeepPlanningAvailability {
  readonly supported: boolean;
  readonly reason: string | null;
  readonly reasonKey?:
    | "chat.deepPlan.reason.connect"
    | "chat.deepPlan.unavailable"
    | "chat.deepPlan.reason.provider"
    | "chat.deepPlan.reason.unavailableProvider"
    | "chat.deepPlan.providerUnavailable";
}

export function resolveDeepPlanningAvailability(input: {
  readonly capabilities: ExecutionEnvironmentCapabilities | null | undefined;
  readonly provider: ServerProvider | null | undefined;
  readonly connected?: boolean;
}): DeepPlanningAvailability {
  if (input.connected === false) {
    return {
      supported: false,
      reason: "Connect to this environment to use DeepPlan.",
      reasonKey: "chat.deepPlan.reason.connect",
    };
  }
  const capability = input.capabilities?.deepPlanning;
  if (capability?.version !== 1 || !capability.sourceExport || !capability.sourceImport) {
    return {
      supported: false,
      reason: "This environment does not support DeepPlan.",
      reasonKey: "chat.deepPlan.unavailable",
    };
  }
  if (!input.provider) {
    return {
      supported: false,
      reason: "Select a provider to use DeepPlan.",
      reasonKey: "chat.deepPlan.reason.provider",
    };
  }
  if (
    !input.provider.enabled ||
    !input.provider.installed ||
    input.provider.availability === "unavailable"
  ) {
    return {
      supported: false,
      reason: "The selected provider is unavailable.",
      reasonKey: "chat.deepPlan.reason.unavailableProvider",
    };
  }
  const providerCapability = input.provider.deepPlanning;
  if (
    providerCapability?.version !== 1 ||
    !providerCapability.structuredPlans ||
    !providerCapability.durableExecution
  ) {
    return {
      supported: false,
      reason: "The selected provider does not support DeepPlan.",
      reasonKey: "chat.deepPlan.providerUnavailable",
    };
  }
  return { supported: true, reason: null };
}
