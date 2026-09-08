import * as Effect from "effect/Effect";

import Migration0035 from "./035_ProjectionThreadTitleRegeneration.ts";
import Migration0036 from "./036_ProjectSpeechProfilesCompatibility.ts";
import Migration0038 from "./038_ProjectionThreadsSnoozedCompatibility.ts";

// Fork and upstream builds assigned different meanings to IDs 33-38. Reapply
// the idempotent canonical repairs without rewriting historical ledger rows.
export default Effect.gen(function* () {
  yield* Migration0036;
  yield* Migration0038;
  yield* Migration0035;
});
