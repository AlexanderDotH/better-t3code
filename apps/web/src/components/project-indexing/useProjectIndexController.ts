import {
  createProjectIndexController,
  type ProjectIndexClientApi,
} from "@t3tools/client-runtime/project-indexing";
import type { ProjectIndexScopeInput } from "@t3tools/contracts";
import { useEffect, useMemo, useSyncExternalStore } from "react";

export function useProjectIndexController(
  api: ProjectIndexClientApi,
  scope: ProjectIndexScopeInput,
) {
  const controller = useMemo(() => createProjectIndexController({ api, scope }), [api, scope]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.refresh().catch(() => undefined);
    return () => controller.dispose();
  }, [controller]);

  useEffect(() => {
    if (snapshot.invalidationEpoch > 0) void controller.refresh().catch(() => undefined);
  }, [controller, snapshot.invalidationEpoch]);

  return { controller, snapshot };
}
