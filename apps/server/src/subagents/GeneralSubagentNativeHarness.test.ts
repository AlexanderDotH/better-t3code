import { expect, it, vi } from "@effect/vitest";
import { ProviderInstanceId, SubagentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { GeneralSubagentCoordinator } from "./GeneralSubagentCoordinator.ts";
import {
  GENERAL_SUBAGENT_NATIVE_HARNESS_DECLARATIONS,
  makeGeneralSubagentNativeHarnessExtension,
} from "./GeneralSubagentNativeHarness.ts";

const parentThreadId = ThreadId.make("native-harness-parent");
const providerInstanceId = ProviderInstanceId.make("chatgpt-subscription");
const agentId = SubagentId.make("general:native-harness-parent:agent-1");

it.effect("publishes the six direct-agent aliases and binds execution to its root caller", () => {
  const followUp = vi.fn(() =>
    Effect.succeed({
      agent: {
        agentId,
        status: "running" as const,
        providerInstanceId,
        providerDriver: "chatgpt",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        task: "Run the follow-up.",
        output: null,
        detail: null,
      },
      queued: true,
    }),
  );
  const coordinator = GeneralSubagentCoordinator.of({
    listModels: () => Effect.succeed({ providers: [] }),
    spawn: () => Effect.die("unused"),
    wait: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
    listAgents: () => Effect.succeed({ agents: [] }),
    spawnAgent: () => Effect.die("unused"),
    sendMessage: () => Effect.die("unused"),
    followUp,
    waitAgent: () => Effect.die("unused"),
    interruptAgent: () => Effect.die("unused"),
  });

  return Effect.gen(function* () {
    const extension = yield* makeGeneralSubagentNativeHarnessExtension({
      parentThreadId,
      callerProviderInstanceId: providerInstanceId,
    });
    expect(extension.declarations.map(({ name }) => name)).toEqual([
      "list_agents",
      "spawn_agent",
      "send_message",
      "followup_task",
      "wait_agent",
      "interrupt_agent",
    ]);

    const result = yield* extension.execute({
      name: "followup_task",
      args: { agentId, task: "Run the follow-up." },
      cwd: process.cwd(),
      environment: {},
    });
    expect(result).toMatchObject({ ok: true, title: "Follow up with direct agent" });
    expect(followUp).toHaveBeenCalledWith({
      parentThreadId,
      callerProviderInstanceId: providerInstanceId,
      agentId,
      task: "Run the follow-up.",
    });
  }).pipe(Effect.provideService(GeneralSubagentCoordinator, coordinator));
});

it("describes list_agents as compact identity and status metadata", () => {
  const description = GENERAL_SUBAGENT_NATIVE_HARNESS_DECLARATIONS.find(
    ({ name }) => name === "list_agents",
  )?.description;

  expect(description).toContain("identity");
  expect(description).toContain("status");
  expect(description).not.toMatch(/transcript|task|result|failure/i);
});
