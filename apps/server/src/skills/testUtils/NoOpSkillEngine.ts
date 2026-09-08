import { SkillEngineError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SkillEngine, type SkillEngineShape } from "../Services/SkillEngine.ts";

export const NoOpSkillEngineLayer = Layer.succeed(SkillEngine, {
  list: () => Effect.succeed({ skills: [] }),
  discoverImportSources: Effect.succeed({ sources: [] }),
  importSources: () => Effect.succeed({ skills: [] }),
  create: () =>
    Effect.fail(
      new SkillEngineError({ message: "Skill mutations are not available in this test." }),
    ),
  update: () =>
    Effect.fail(
      new SkillEngineError({ message: "Skill mutations are not available in this test." }),
    ),
  rename: () =>
    Effect.fail(
      new SkillEngineError({ message: "Skill mutations are not available in this test." }),
    ),
  delete: () => Effect.succeed({ skills: [] }),
  setEnabled: () =>
    Effect.fail(
      new SkillEngineError({ message: "Skill mutations are not available in this test." }),
    ),
  rewritePromptForProvider: (input) => Effect.succeed(input.prompt),
} satisfies SkillEngineShape);
