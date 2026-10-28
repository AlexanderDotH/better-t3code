import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { forkParked } from "../../serverActivation.ts";
import * as ProjectIndexingRuntime from "./ProjectIndexingRuntime.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const indexing = yield* ProjectIndexingRuntime.ProjectIndexingRuntime;
    yield* indexing.recover.pipe(
      Effect.catchCause(() =>
        Effect.logWarning(
          "Project indexing recovery could not finish; normal chat remains available.",
        ),
      ),
      forkParked,
    );
  }),
);
