import { useAtomValue } from "@effect/atom-react";
import { ProjectIndexModelSelection, type ProjectIndexModelCheckResult } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

type CheckModel = (selection: ProjectIndexModelSelection) => Promise<ProjectIndexModelCheckResult>;

class ModelCheckKey extends Data.Class<{
  readonly checkModel: CheckModel;
  readonly selection: string;
  readonly attempt: number;
}> {}
const selectionJson = Schema.fromJsonString(ProjectIndexModelSelection);
const decodeSelection = Schema.decodeUnknownSync(selectionJson);
const encodeSelection = Schema.encodeSync(selectionJson);
const modelChecks = Atom.family((input: ModelCheckKey) => {
  const selection = decodeSelection(input.selection);
  return Atom.make(
    Effect.tryPromise(() => input.checkModel(selection)).pipe(
      Effect.match({
        onSuccess: (result): ProjectIndexModelCheckResult | null => result,
        onFailure: (failure): ProjectIndexModelCheckResult | null => ({
          supported: false,
          reason: failure.cause instanceof Error ? failure.cause.message : String(failure.cause),
        }),
      }),
    ),
  );
});
const emptyCheck = Atom.make(Effect.succeed<ProjectIndexModelCheckResult | null>(null));

export function useProjectIndexModelCheck(
  checkModel: CheckModel,
  selection: ProjectIndexModelSelection | null,
  attempt = 0,
) {
  const check = useAtomValue(
    selection === null
      ? emptyCheck
      : modelChecks(
          new ModelCheckKey({ checkModel, selection: encodeSelection(selection), attempt }),
        ),
  );
  return check._tag === "Success" ? check.value : null;
}
