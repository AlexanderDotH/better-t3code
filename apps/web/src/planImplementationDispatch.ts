import type { ProviderInstanceId, ServerProvider } from "@t3tools/contracts";

import {
  buildPlanImplementationPrompt,
  type PlanImplementationStrategy,
} from "./planImplementation";

export type PlanImplementationDispatchResolution =
  | {
      readonly _tag: "Ready";
      readonly prompt: string;
    }
  | {
      readonly _tag: "Blocked";
      readonly error: string;
    };

function formatPlanImplementationDispatchError(error: unknown): string {
  const detail =
    error instanceof Error ? error.message : "Selected provider cannot use native subagents";
  return [
    "Parallel plan implementation is no longer available for the selected provider.",
    `${detail}.`,
    "Choose Implement normally or select a provider with native subagent support.",
  ].join(" ");
}

export function resolvePlanImplementationDispatch(input: {
  readonly planMarkdown: string;
  readonly strategy: PlanImplementationStrategy;
  readonly selectedProviderInstanceId: ProviderInstanceId;
  readonly providerStatuses: ReadonlyArray<ServerProvider>;
}): PlanImplementationDispatchResolution {
  const selectedProvider = input.providerStatuses.find(
    (provider) => provider.instanceId === input.selectedProviderInstanceId,
  );

  try {
    return {
      _tag: "Ready",
      prompt: buildPlanImplementationPrompt(input.planMarkdown, {
        strategy: input.strategy,
        ...(selectedProvider ? { provider: selectedProvider } : {}),
      }),
    };
  } catch (error) {
    return {
      _tag: "Blocked",
      error: formatPlanImplementationDispatchError(error),
    };
  }
}
