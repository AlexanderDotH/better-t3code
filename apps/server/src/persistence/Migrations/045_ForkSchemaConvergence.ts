import * as Effect from "effect/Effect";

import Migration0039 from "./039_ProjectionThreadSessionAbortState.ts";
import Migration0040 from "./040_ProjectionCompatibility.ts";
import Migration0041 from "./041_ProjectionThreadSubagents.ts";

// Upstream releases used ledger IDs 36-40 for pinning, pagination, and
// project metadata. A database created by one of those releases skips the
// fork migrations recorded at those same IDs. Reapply the fork's idempotent
// repair set at the first immutable, collision-free ID without rewriting any
// historical ledger rows.
export default Effect.gen(function* () {
  yield* Migration0040;
  yield* Migration0041;
  yield* Migration0039;
});
