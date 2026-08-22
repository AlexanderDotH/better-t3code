import { expect, it, vi } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, SubagentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  GeneralSubagentCoordinator,
  type GeneralSubagentCoordinatorShape,
} from "../../../subagents/GeneralSubagentCoordinator.ts";
import { invokeGeneralSubagentSpawn } from "./handlers.ts";

it.effect("binds subagent creation to the authenticated parent thread and provider", () => {
  const spawn = vi.fn<GeneralSubagentCoordinatorShape["spawn"]>((input) =>
    Effect.succeed({
      agentId: SubagentId.make("general:parent:agent-1"),
      status: "starting",
      providerInstanceId: input.providerInstanceId ?? input.callerProviderInstanceId,
      providerDriver: "codex",
      model: input.model ?? "gpt-5.6-sol",
      reasoningEffort: input.reasoningEffort ?? null,
    }),
  );
  const coordinator = GeneralSubagentCoordinator.of({
    listModels: () => Effect.succeed({ providers: [] }),
    spawn,
    wait: () => Effect.succeed({ agents: [], allTerminal: true, timedOut: false }),
    cancel: () => Effect.die("unused"),
  });
  const invocation: McpInvocationContext.McpInvocationScope = {
    environmentId: EnvironmentId.make("environment-test"),
    threadId: ThreadId.make("parent-thread"),
    providerSessionId: "provider-session-test",
    providerInstanceId: ProviderInstanceId.make("codex-work"),
    capabilities: new Set(["workspace", "coordination"]),
    issuedAt: 1,
  };

  return invokeGeneralSubagentSpawn({
    task: "Implement the isolated parser change and its focused tests.",
    providerInstanceId: ProviderInstanceId.make("claude-review"),
    model: "claude-opus-4-6",
    reasoningEffort: "high",
  }).pipe(
    Effect.provideService(GeneralSubagentCoordinator, coordinator),
    Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
    Effect.tap((result) =>
      Effect.sync(() => {
        expect(result.providerInstanceId).toBe("claude-review");
        expect(spawn).toHaveBeenCalledWith({
          parentThreadId: invocation.threadId,
          callerProviderInstanceId: invocation.providerInstanceId,
          task: "Implement the isolated parser change and its focused tests.",
          providerInstanceId: ProviderInstanceId.make("claude-review"),
          model: "claude-opus-4-6",
          reasoningEffort: "high",
        });
      }),
    ),
  );
});
