import {
  createProjectIndexController,
  type ProjectIndexClientApi,
} from "@t3tools/client-runtime/project-indexing";
import type { ProjectIndexScopeInput } from "@t3tools/contracts";
import { useState, useSyncExternalStore } from "react";

export function useProjectIndexController(
  api: ProjectIndexClientApi,
  scope: ProjectIndexScopeInput,
) {
  const [resource, setResource] = useState(() => ({
    api,
    scope,
    controller: createProjectIndexController({ api, scope }),
  }));
  if (
    resource.api !== api ||
    resource.scope.projectId !== scope.projectId ||
    resource.scope.threadId !== scope.threadId
  ) {
    setResource({ api, scope, controller: createProjectIndexController({ api, scope }) });
  }
  const { controller } = resource;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, snapshot };
}
