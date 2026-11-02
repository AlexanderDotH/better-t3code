import * as Effect from "effect/Effect";

import Migration0039 from "./039_ProjectionThreadSessionAbortState.ts";
import Migration0040 from "./040_ProjectionCompatibility.ts";
import Migration0041 from "./041_ProjectionThreadSubagents.ts";

// Reapply idempotent fork repairs skipped by colliding upstream migration IDs.
export default Effect.gen(function* () {
  yield* Migration0040;
  yield* Migration0041;
  yield* Migration0039;
});
