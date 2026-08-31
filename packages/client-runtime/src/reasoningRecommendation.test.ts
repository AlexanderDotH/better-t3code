import { describe, expect, it } from "vite-plus/test";
import {
  EventId,
  ProviderInstanceId,
  TurnId,
  type ModelCapabilities,
  type ModelSelection,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

import {
  acceptReasoningRecommendation,
  consumeReasoningRecommendationOverride,
  deriveReasoningRecommendation,
  dismissReasoningRecommendation,
  reconcileReasoningRecommendationState,
  resolveReasoningTurnModelSelection,
  undoReasoningRecommendationOverride,
  type ReasoningRecommendationState,
} from "./reasoningRecommendation.ts";

const capabilities = {
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra high" },
        { id: "max", label: "Max" },
      ],
    },
  ],
} satisfies ModelCapabilities;

const selection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
  options: [
    { id: "reasoningEffort", value: "max" },
    { id: "serviceTier", value: "priority" },
  ],
} satisfies ModelSelection;

function activity(input: {
  readonly id: string;
  readonly turnId?: string;
  readonly itemType: string;
  readonly command?: string | ReadonlyArray<string>;
  readonly payload?: Record<string, unknown>;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    tone: "tool",
    kind: "tool.completed",
    summary: input.id,
    payload: {
      itemType: input.itemType,
      ...(input.command === undefined ? {} : { data: { item: { command: input.command } } }),
      ...input.payload,
    },
    turnId: TurnId.make(input.turnId ?? "turn-latest"),
    createdAt: "2026-07-31T12:00:00.000Z",
  };
}

function derive(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  overrides: Partial<Parameters<typeof deriveReasoningRecommendation>[0]> = {},
) {
  return deriveReasoningRecommendation({
    activities,
    capabilities,
    durableSelection: selection,
    latestCompletedTurnId: TurnId.make("turn-latest"),
    threadIdle: true,
    handledEvidenceTurnId: null,
    ...overrides,
  });
}

describe("reasoning recommendation", () => {
  it("recommends High after an exploration-only completed turn", () => {
    const recommendation = derive([
      activity({ id: "rg", itemType: "command_execution", command: ["rg", "foo", "."] }),
      activity({ id: "cat", itemType: "command_execution", command: "cat package.json" }),
      activity({ id: "pwd", itemType: "command_execution", command: "pwd" }),
      activity({
        id: "git",
        itemType: "command_execution",
        command: ["git", "-C", "/repo", "status", "--short"],
      }),
    ]);

    expect(recommendation).toMatchObject({
      evidenceTurnId: "turn-latest",
      discoveryOperationCount: 4,
      completedToolOperationCount: 4,
      optionId: "reasoningEffort",
      currentValue: "max",
      currentLabel: "Max",
      targetValue: "high",
      targetLabel: "High",
    });
  });

  it("counts the queries and reads inside one workspace_context call", () => {
    const recommendation = derive([
      activity({
        id: "workspace",
        itemType: "mcp_tool_call",
        payload: {
          data: {
            item: {
              server: "t3-code",
              tool: "workspace_context",
              arguments: {
                queries: [{ text: "one" }, { text: "two" }, { text: "three" }],
                reads: [{ path: "package.json" }],
              },
            },
          },
        },
      }),
    ]);

    expect(recommendation).toMatchObject({
      discoveryOperationCount: 4,
      completedToolOperationCount: 4,
    });
  });

  it("recognizes conservative Codex, Claude, and Cursor command payload shapes", () => {
    const recommendation = derive([
      activity({
        id: "codex",
        itemType: "command_execution",
        command: ["/bin/zsh", "-lc", "rg -n workspace_context apps"],
      }),
      activity({
        id: "claude",
        itemType: "command_execution",
        payload: { data: { command: "git diff --stat" } },
      }),
      activity({
        id: "cursor",
        itemType: "command_execution",
        payload: { detail: "/bin/bash -lc 'sed -n ‘1,80p’ package.json'" },
      }),
      activity({ id: "find", itemType: "command_execution", command: "find apps -type f" }),
    ]);

    expect(recommendation?.discoveryOperationCount).toBe(4);
  });

  it("does not recommend below the four-operation threshold or below the eighty-percent ratio", () => {
    expect(
      derive([
        activity({ id: "one", itemType: "command_execution", command: "rg one" }),
        activity({ id: "two", itemType: "command_execution", command: "cat two" }),
        activity({ id: "three", itemType: "command_execution", command: "pwd" }),
      ]),
    ).toBeNull();

    expect(
      derive([
        activity({ id: "one", itemType: "command_execution", command: "rg one" }),
        activity({ id: "two", itemType: "command_execution", command: "cat two" }),
        activity({ id: "three", itemType: "command_execution", command: "pwd" }),
        activity({ id: "four", itemType: "command_execution", command: "git log -1" }),
        activity({ id: "unknown", itemType: "command_execution", command: "python inspect.py" }),
      ]),
    ).toMatchObject({
      discoveryOperationCount: 4,
      completedToolOperationCount: 5,
    });

    expect(
      derive([
        activity({ id: "one", itemType: "command_execution", command: "rg one" }),
        activity({ id: "two", itemType: "command_execution", command: "cat two" }),
        activity({ id: "three", itemType: "command_execution", command: "pwd" }),
        activity({ id: "four", itemType: "command_execution", command: "git log -1" }),
        activity({ id: "test", itemType: "command_execution", command: "pnpm test" }),
        activity({ id: "build", itemType: "command_execution", command: "pnpm build" }),
      ]),
    ).toBeNull();
  });

  it("rejects file changes, known mutations, shell controls, and unknown commands", () => {
    const base = [
      activity({ id: "one", itemType: "command_execution", command: "rg one" }),
      activity({ id: "two", itemType: "command_execution", command: "cat two" }),
      activity({ id: "three", itemType: "command_execution", command: "pwd" }),
      activity({ id: "four", itemType: "command_execution", command: "git log -1" }),
    ];

    expect(derive([...base, activity({ id: "edit", itemType: "file_change" })])).toBeNull();
    expect(
      derive([...base, activity({ id: "remove", itemType: "command_execution", command: "rm x" })]),
    ).toBeNull();
    expect(
      derive([
        activity({ id: "one", itemType: "command_execution", command: "rg one && rg two" }),
        activity({ id: "two", itemType: "command_execution", command: "cat two" }),
        activity({ id: "three", itemType: "command_execution", command: "pwd" }),
        activity({ id: "four", itemType: "command_execution", command: "git log -1" }),
      ]),
    ).toBeNull();
    expect(
      derive([
        ...base,
        activity({
          id: "controlled",
          itemType: "command_execution",
          command: "rg hidden | head",
        }),
      ]),
    ).toBeNull();
    expect(
      derive([
        ...base,
        activity({
          id: "unknown-git",
          itemType: "command_execution",
          command: "git maintenance run",
        }),
      ]),
    ).toBeNull();
    expect(
      derive([
        ...base.slice(0, 3),
        activity({ id: "unknown", itemType: "command_execution", command: "python inspect.py" }),
      ]),
    ).toBeNull();
  });

  it("waits for idle, completed, new evidence and an effort above High", () => {
    const activities = [
      activity({ id: "one", itemType: "command_execution", command: "rg one" }),
      activity({ id: "two", itemType: "command_execution", command: "cat two" }),
      activity({ id: "three", itemType: "command_execution", command: "pwd" }),
      activity({ id: "four", itemType: "command_execution", command: "git log -1" }),
    ];

    expect(derive(activities, { threadIdle: false })).toBeNull();
    expect(derive(activities, { latestCompletedTurnId: null })).toBeNull();
    expect(derive(activities, { handledEvidenceTurnId: "turn-latest" })).toBeNull();
    expect(
      derive(activities, {
        durableSelection: {
          ...selection,
          options: [{ id: "reasoningEffort", value: "high" }],
        },
      }),
    ).toBeNull();
    expect(
      derive(activities, {
        durableSelection: {
          ...selection,
          options: [...(selection.options ?? []), { id: "t3AutoReasoning", value: true }],
        },
      }),
    ).toBeNull();
  });

  it("uses the highest supported lower value when High is absent", () => {
    const recommendation = derive(
      [
        activity({ id: "one", itemType: "command_execution", command: "rg one" }),
        activity({ id: "two", itemType: "command_execution", command: "cat two" }),
        activity({ id: "three", itemType: "command_execution", command: "pwd" }),
        activity({ id: "four", itemType: "command_execution", command: "git log -1" }),
      ],
      {
        capabilities: {
          optionDescriptors: [
            {
              id: "effort",
              label: "Effort",
              type: "select",
              options: [
                { id: "low", label: "Low" },
                { id: "medium", label: "Medium" },
                { id: "max", label: "Maximum" },
              ],
            },
          ],
        },
        durableSelection: {
          ...selection,
          options: [{ id: "effort", value: "max" }],
        },
      },
    );

    expect(recommendation).toMatchObject({ optionId: "effort", targetValue: "medium" });
  });

  it("arms, applies, consumes, dismisses, and undoes exactly one transient override", () => {
    const recommendation = derive([
      activity({ id: "one", itemType: "command_execution", command: "rg one" }),
      activity({ id: "two", itemType: "command_execution", command: "cat two" }),
      activity({ id: "three", itemType: "command_execution", command: "pwd" }),
      activity({ id: "four", itemType: "command_execution", command: "git log -1" }),
    ])!;
    const accepted = acceptReasoningRecommendation(null, recommendation);
    const pendingOverride = accepted.pendingOverride;
    if (!pendingOverride) {
      throw new Error("Accepting a recommendation must arm an override");
    }
    const resolved = resolveReasoningTurnModelSelection(selection, pendingOverride);

    expect(resolved.applied).toBe(true);
    expect(resolved.turnModelSelection).toEqual({
      ...selection,
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "priority" },
      ],
    });
    expect(selection.options?.[0]?.value).toBe("max");
    // A failed send leaves the armed state untouched. Only a successful start
    // calls the consumption helper, after which following turns use the
    // durable selection again.
    expect(accepted.pendingOverride).toEqual(pendingOverride);
    const consumed = consumeReasoningRecommendationOverride(accepted, pendingOverride);
    expect(consumed).toEqual({
      handledEvidenceTurnId: "turn-latest",
    });
    expect(resolveReasoningTurnModelSelection(selection, consumed.pendingOverride)).toEqual({
      turnModelSelection: selection,
      applied: false,
    });
    expect(undoReasoningRecommendationOverride(accepted)).toEqual({
      handledEvidenceTurnId: "turn-latest",
    });
    expect(dismissReasoningRecommendation(null, recommendation)).toEqual({
      handledEvidenceTurnId: "turn-latest",
    });
  });

  it("retains an override after unrelated option changes but cancels it after model or effort changes", () => {
    const pendingState = {
      handledEvidenceTurnId: "turn-latest",
      pendingOverride: {
        evidenceTurnId: "turn-latest",
        instanceId: "codex",
        model: "gpt-5.6-sol",
        optionId: "reasoningEffort",
        fromValue: "max",
        fromLabel: "Max",
        targetValue: "high",
        targetLabel: "High",
      },
    } satisfies ReasoningRecommendationState;

    expect(
      reconcileReasoningRecommendationState(pendingState, {
        ...selection,
        options: [
          { id: "reasoningEffort", value: "max" },
          { id: "serviceTier", value: "default" },
        ],
      }),
    ).toBe(pendingState);
    expect(
      reconcileReasoningRecommendationState(pendingState, {
        ...selection,
        model: "gpt-5.6-terra",
      }),
    ).toEqual({ handledEvidenceTurnId: "turn-latest" });
    expect(
      reconcileReasoningRecommendationState(pendingState, {
        ...selection,
        options: [{ id: "reasoningEffort", value: "xhigh" }],
      }),
    ).toEqual({ handledEvidenceTurnId: "turn-latest" });
  });
});
