import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect } from "react";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useEnvironments } from "../../state/environments";
import { useProjectIndexActivityStore } from "../../state/projectIndexActivity";
import { projectIndexEnvironment } from "../../state/projectIndexing";

function EnvironmentActivitySubscription({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  useEffect(() => {
    const activity = projectIndexEnvironment.activity({ environmentId, input: {} });
    const unsubscribe = appAtomRegistry.subscribe(
      activity,
      (result) => {
        const store = useProjectIndexActivityStore.getState();
        if (result._tag === "Success") store.applyEvent(environmentId, result.value);
        else if (result._tag === "Failure") store.clearEnvironment(environmentId);
      },
      { immediate: true },
    );
    return () => {
      unsubscribe();
      useProjectIndexActivityStore.getState().clearEnvironment(environmentId);
    };
  }, [environmentId]);
  return null;
}

export function ProjectIndexActivitySubscriptions() {
  const { environments } = useEnvironments();
  return environments
    .filter(
      (environment) =>
        (environment.serverConfig?.environment.capabilities.projectIndexingVersion ?? 0) >= 3,
    )
    .map((environment) => (
      <EnvironmentActivitySubscription
        key={environment.environmentId}
        environmentId={environment.environmentId}
      />
    ));
}
