import * as Effect from "effect/Effect";

import { migrationEntries } from "./LegacyForkMigrations.ts";

// Every fork addition after divergence is idempotent, including the historical
// collision repairs. Keep their dependency order when upgrading native upstream.
export default Effect.gen(function* () {
  for (const [id, , migration] of migrationEntries) {
    if (id >= 36) yield* migration;
  }
});
