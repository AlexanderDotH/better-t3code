import { resolveDeepPlanningAvailability } from "@t3tools/client-runtime/deep-planning";
import type {
  ComposerMode,
  ExecutionEnvironmentCapabilities,
  ServerProvider,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

export function composerModeAvailability(
  input: {
    readonly provider?: ServerProvider | null;
    readonly capabilities?: ExecutionEnvironmentCapabilities | null;
    readonly connected?: boolean;
    readonly planningEnabled?: boolean;
    readonly multipleModels?: boolean;
  },
  translator: InterfaceTranslator,
): Readonly<Record<ComposerMode, string | null>> {
  const deepPlan = resolveDeepPlanningAvailability({
    provider: input.provider,
    capabilities: input.capabilities,
    connected: input.connected,
  });
  return {
    default: null,
    chat: null,
    plan:
      input.planningEnabled === false || input.provider?.showInteractionModeToggle === false
        ? translator.message("mobile.composer.planUnavailable")
        : null,
    "deep-plan": input.multipleModels
      ? translator.message("mobile.composer.deepPlanSingleModel")
      : deepPlan.reasonKey
        ? translator.message(deepPlan.reasonKey)
        : deepPlan.reason,
  };
}

export function nextAvailableComposerMode(
  mode: ComposerMode,
  unavailable?: Readonly<Partial<Record<ComposerMode, string | null>>>,
) {
  const modes = ["default", "plan", "deep-plan", "chat"] as const;
  const index = modes.indexOf(mode);
  for (let offset = 1; offset <= modes.length; offset++) {
    const candidate = modes[(index + offset) % modes.length]!;
    if (!unavailable?.[candidate]) return candidate;
  }
  return mode;
}
