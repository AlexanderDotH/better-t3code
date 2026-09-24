import type { ProjectIndexModelCheckResult, ProjectIndexModelSelection } from "@t3tools/contracts";
import { useEffect, useState } from "react";

export function useProjectIndexModelCheck(
  checkModel: (selection: ProjectIndexModelSelection) => Promise<ProjectIndexModelCheckResult>,
  selection: ProjectIndexModelSelection | null,
  attempt = 0,
) {
  const instanceId = selection?.instanceId;
  const model = selection?.model;
  const options = selection?.options;
  const key = JSON.stringify([selection, attempt]);
  const [check, setCheck] = useState<{
    readonly key: string;
    readonly result: ProjectIndexModelCheckResult;
  } | null>(null);
  useEffect(() => {
    if (!instanceId || !model) return;
    let active = true;
    void checkModel({ instanceId, model, ...(options ? { options } : {}) }).then(
      (result) => {
        if (active) setCheck({ key, result });
      },
      (failure: unknown) => {
        if (active)
          setCheck({
            key,
            result: {
              supported: false,
              reason: failure instanceof Error ? failure.message : String(failure),
            },
          });
      },
    );
    return () => {
      active = false;
    };
  }, [checkModel, instanceId, key, model, options]);
  return check?.key === key ? check.result : null;
}
