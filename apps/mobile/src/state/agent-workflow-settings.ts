import { resolveFetchMode } from "@t3tools/shared/fetchMode";

export interface MobileAgentWorkflowSettings {
  readonly supported: boolean;
  readonly fetchEnabled: boolean;
  readonly fetchMode: "repository-exploration" | undefined;
}

export function resolveMobileAgentWorkflowSettings(input: {
  readonly agentWorkflowVersion: number | undefined;
  readonly experimentalFetch: boolean | undefined;
}): MobileAgentWorkflowSettings {
  const supported = input.agentWorkflowVersion !== undefined;
  const fetchEnabled = supported && input.experimentalFetch === true;
  return {
    supported,
    fetchEnabled,
    fetchMode: resolveFetchMode({ featureEnabled: fetchEnabled }),
  };
}
