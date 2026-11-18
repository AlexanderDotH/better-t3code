import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import {
  getCodexServiceTierOptionValue,
  resolveCodexCyberAccessProgram,
} from "./codexModelOptions.ts";

it("keeps legacy persisted fast mode selections working", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "fastMode", value: true },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "priority");
});

it.effect.each<{
  enabled: boolean | undefined;
  programs: CodexSchema.V2ModelListResponse__ModelAccessPrograms | null | undefined;
  expected: string | undefined;
}>([
  { enabled: true, programs: { cyber: ["standard", "daybreakBlue"] }, expected: "daybreakBlue" },
  { enabled: true, programs: { cyber: ["daybreakRed"] }, expected: "daybreakRed" },
  { enabled: true, programs: { cyber: ["daybreakRed", "daybreakBlue"] }, expected: "daybreakBlue" },
  { enabled: true, programs: { cyber: ["standard"] }, expected: "unsupported" },
  { enabled: false, programs: { cyber: ["standard", "daybreakBlue"] }, expected: "standard" },
  { enabled: false, programs: { cyber: ["daybreakBlue"] }, expected: undefined },
  { enabled: undefined, programs: { cyber: ["standard", "daybreakBlue"] }, expected: undefined },
  { enabled: true, programs: { cyber: [] }, expected: "unsupported" },
  { enabled: true, programs: null, expected: "unsupported" },
  { enabled: false, programs: null, expected: undefined },
  { enabled: true, programs: undefined, expected: "unsupported" },
])(
  "resolves Daybreak intent from advertised access programs: %j",
  ({ enabled, programs, expected }) =>
    Effect.gen(function* () {
      const selection = createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-test",
        enabled === undefined ? [] : [{ id: "daybreak", value: enabled }],
      );
      const resolution = resolveCodexCyberAccessProgram(selection, programs);
      if (expected === "unsupported") {
        const error = yield* Effect.flip(resolution);
        assert.equal(error.model, "gpt-test");
        assert.include(error.message, "Daybreak support for model gpt-test could not be confirmed");
      } else {
        assert.equal(yield* resolution, expected);
      }
    }),
);
