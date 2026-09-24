import type { ProjectIndexModelCheckResult, ProjectIndexModelSelection } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function useProjectIndexModelCheck(input: {
  readonly selectionKey: string;
  readonly getSelection: () => ProjectIndexModelSelection | null;
  readonly checkModel: (
    selection: ProjectIndexModelSelection,
  ) => Promise<ProjectIndexModelCheckResult>;
}) {
  const translator = useMobileInterfaceTranslator();
  const { selectionKey, getSelection, checkModel } = input;
  const [completed, setCompleted] = useState<{
    readonly key: string;
    readonly result: ProjectIndexModelCheckResult;
  } | null>(null);
  useEffect(() => {
    const selection = getSelection();
    if (!selection) return;
    let active = true;
    void checkModel(selection).then(
      (result) => {
        if (active) setCompleted({ key: selectionKey, result });
      },
      (error: unknown) => {
        if (active)
          setCompleted({
            key: selectionKey,
            result: {
              supported: false,
              reason:
                error instanceof Error
                  ? error.message
                  : translator.message("projectIndexing.modelUnsupported"),
            },
          });
      },
    );
    return () => {
      active = false;
    };
  }, [checkModel, getSelection, selectionKey, translator]);
  const result =
    selectionKey !== "null" && completed?.key === selectionKey ? completed.result : null;
  return { result, checking: selectionKey !== "null" && result === null };
}
