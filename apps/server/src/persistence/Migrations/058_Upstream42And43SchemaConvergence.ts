import * as Effect from "effect/Effect";

import Migration0042 from "./042_GitWorkbenchState.ts";
import Migration0043 from "./043_ProjectionThreadSubagentFetchMetadata.ts";

// Native upstream used ledger IDs 42 and 43 for linked pull requests and
// unsettled timestamps. Reapply the fork's idempotent migrations from those
// slots after both histories have reached the shared 56/57 schema additions.
export default Effect.gen(function* () {
  yield* Migration0042;
  yield* Migration0043;
});
