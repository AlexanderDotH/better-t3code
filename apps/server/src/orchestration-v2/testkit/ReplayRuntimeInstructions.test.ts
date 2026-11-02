import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, type ProviderReplayTranscript } from "@t3tools/contracts";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";

import { materializeReplayTranscriptRuntimeInstructions } from "./ReplayRuntimeInstructions.ts";

const runtime = { driver: ProviderDriverKind.make("cursor"), model: "composer-2.5" };
const transcript = (
  message: string,
  mode: "agent" | "plan" = "agent",
): ProviderReplayTranscript => ({
  provider: "cursor",
  protocol: "cursor-agent-sdk.local",
  version: "1",
  scenario: "instruction-boundary",
  entries: [
    {
      type: "expect_outbound",
      label: "run.start",
      frame: { type: "run.start", message, options: { model: { id: runtime.model }, mode } },
    },
    {
      type: "emit_inbound",
      frame: {
        type: "run.started",
        runId: "recorded-native-run",
        agentId: "recorded-native-agent",
      },
    },
  ],
});

it.each(["agent", "plan"] as const)(
  "updates Cursor %s instructions once while preserving the SDK boundary",
  (mode) => {
    const original = transcript("Inspect the existing code", mode);
    const result = materializeReplayTranscriptRuntimeInstructions(original, runtime);
    assert.deepEqual(result.entries[0], {
      type: "expect_outbound",
      label: "run.start",
      frame: {
        type: "run.start",
        message: `Inspect the existing code\n\n${buildRuntimeInstructions({ harness: "Cursor", model: runtime.model, interactionMode: mode === "plan" ? "plan" : "default", deepPlan: null })}`,
        options: { model: { id: runtime.model }, mode },
      },
    });
    assert.deepEqual(result.entries[1], original.entries[1]);
    assert.deepEqual(original, transcript("Inspect the existing code", mode));
    assert.deepEqual(materializeReplayTranscriptRuntimeInstructions(result, runtime), result);
  },
);

it("upgrades the earlier Cursor suffix without duplicating instructions", () => {
  const legacy = buildRuntimeInstructions({ harness: "Cursor", model: runtime.model });
  assert.deepEqual(
    materializeReplayTranscriptRuntimeInstructions(
      transcript(`Inspect the existing code\n\n${legacy}`),
      runtime,
    ),
    materializeReplayTranscriptRuntimeInstructions(
      transcript("Inspect the existing code"),
      runtime,
    ),
  );
});

it("keeps Cursor's native compression command verbatim", () => {
  const original = transcript("/compress");
  assert.deepEqual(materializeReplayTranscriptRuntimeInstructions(original, runtime), original);
});
