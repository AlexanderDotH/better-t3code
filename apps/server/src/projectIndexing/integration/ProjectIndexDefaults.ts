import type { ProjectIndexDefaults, ServerSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ServerSettingsService } from "../../serverSettings.ts";

export function projectIndexDefaultsFromSettings(
  settings: Pick<ServerSettings, "projectIndexingEnabled" | "projectIndexingDefaultModelSelection">,
): ProjectIndexDefaults {
  return {
    enabled: settings.projectIndexingEnabled,
    modelSelection: settings.projectIndexingDefaultModelSelection,
  };
}

export const readProjectIndexDefaults = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  return projectIndexDefaultsFromSettings(yield* settings.getSettings);
});
