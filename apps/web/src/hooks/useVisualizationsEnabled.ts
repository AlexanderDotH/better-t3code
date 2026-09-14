import { useAtomValue } from "@effect/atom-react";
import { resolveBetterT3FeatureFlag, type EnvironmentId } from "@t3tools/contracts";

import { serverEnvironment } from "../state/server";

export function useVisualizationsEnabled(environmentId: EnvironmentId | null): boolean {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return (
    config?.environment.capabilities.visualizationsVersion === 1 &&
    resolveBetterT3FeatureFlag(config.settings.betterT3Environment, "chat.visualizations")
  );
}
