import {
  IsoDateTime,
  ProviderDriverKind,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  generalSubagentIdentity,
  generalSubagentIsBusy,
  generalSubagentSnapshot,
  makeActiveGeneralSubagent,
  makeGeneralSubagentStateStore,
  type ActiveGeneralSubagent,
} from "./GeneralSubagentState.ts";

function stateWorker(input: {
  readonly id: string;
  readonly parentThreadId: string;
  readonly syntheticThreadId?: string;
}): ActiveGeneralSubagent {
  return {
    subagentId: SubagentId.make(input.id),
    parentThreadId: ThreadId.make(input.parentThreadId),
    syntheticThreadId: ThreadId.make(input.syntheticThreadId ?? `thread-${input.id}`),
    finalized: false,
  } as ActiveGeneralSubagent;
}

describe("general subagent state", () => {
  it.effect("creates one isolated worker state from the selected provider context", () =>
    Effect.gen(function* () {
      const { worker, summary, reasoningEffort } = yield* makeActiveGeneralSubagent({
        uuid: "worker-1",
        parentThreadId: ThreadId.make("parent"),
        parentTurnId: null,
        parentRuntimeSessionId: null,
        parentProviderInstanceId: ProviderInstanceId.make("codex-parent"),
        selection: {
          instanceId: ProviderInstanceId.make("codex-worker"),
          model: "gpt-5.6-sol",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
        providerDriver: ProviderDriverKind.make("codex"),
        cwd: "/workspace",
        runtimeMode: "approval-required",
        retainSession: true,
        task: "Inspect lifecycle state",
        startedAt: IsoDateTime.make("2026-08-30T00:00:00.000Z"),
      });

      expect(worker.syntheticThreadId).toBe("general:parent:worker-1");
      expect(worker.runtimeSessionId).toBe("runtime:general:parent:worker-1");
      expect(worker.assistantMessageId).toBe("general:parent:worker-1:assistant");
      expect(worker.retainSession).toBe(true);
      expect(worker.followUps).toEqual([]);
      expect(worker.mailbox).toEqual([]);
      expect(reasoningEffort).toBe("high");
      expect(summary).toMatchObject({
        id: "general:parent:worker-1",
        status: "starting",
        task: "Inspect lifecycle state",
        reasoningEffort: "high",
      });
    }),
  );

  it("projects public state and treats queued follow-up work as busy", () => {
    const worker = {
      subagentId: SubagentId.make("agent-state"),
      selection: { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5.6-sol" },
      providerDriver: ProviderDriverKind.make("codex"),
      task: "Inspect state",
      finalAssistantMessage: JSON.stringify({
        outcome: "Finished the state inspection.",
        changesOrFindings: [],
        verification: [],
        risksOrBlockers: [],
        transcriptRef: "subagent:agent-state",
      }),
      detail: null,
      finalized: false,
      turnActive: false,
      followUps: [{ task: "Continue" }],
      summary: {
        id: SubagentId.make("agent-state"),
        label: "State",
        status: "completed",
        statusMessage: null,
        model: "gpt-5.6-sol",
        providerInstanceId: ProviderInstanceId.make("codex-work"),
        providerDriver: ProviderDriverKind.make("codex"),
        reasoningEffort: null,
        latestProgress: null,
        startedAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:01:00.000Z",
      },
    } as ActiveGeneralSubagent;

    expect(generalSubagentIsBusy(worker)).toBe(true);
    expect(generalSubagentIdentity(worker)).toEqual({
      agentId: "agent-state",
      status: "completed",
      providerInstanceId: "codex-work",
      providerDriver: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: null,
    });
    worker.followUps.length = 0;
    expect(generalSubagentIsBusy(worker)).toBe(false);
    expect(generalSubagentSnapshot(worker)).toMatchObject({
      agentId: "agent-state",
      result: {
        outcome: "Finished the state inspection.",
        transcriptRef: "subagent:agent-state",
      },
    });
  });

  it("owns admission, nested-child fencing, direct-child limits, and settled retention", () => {
    const state = makeGeneralSubagentStateStore(1);
    const first = stateWorker({ id: "first", parentThreadId: "root" });
    const second = stateWorker({ id: "second", parentThreadId: "root" });
    const nested = stateWorker({ id: "nested", parentThreadId: first.syntheticThreadId });

    expect(state.admit(first, 1)).toBe("admitted");
    expect(state.admit(second, 1)).toBe("limit");
    expect(state.admit(nested, 1)).toBe("nested");
    expect(state.getByThread(first.syntheticThreadId)).toBe(first);

    state.markSettled(first);
    expect(state.admit(second, 1)).toBe("admitted");
    state.markSettled(second);

    expect(state.getById(first.subagentId)).toBeUndefined();
    expect(state.getById(second.subagentId)).toBe(second);
    expect(state.getByThread(second.syntheticThreadId)).toBeUndefined();
  });
});
