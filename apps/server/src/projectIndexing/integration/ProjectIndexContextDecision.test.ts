import { expect, it } from "@effect/vitest";
import {
  EMPTY_PROJECT_INDEX_COVERAGE,
  DecisionGenerationError,
  ProjectId,
  ProjectIndexOperationError,
  ProviderInstanceId,
  type ProjectIndexQueryResultV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ProjectContextQuery } from "../query/ProjectContextQuery.ts";
import {
  applyProjectIndexContextDecisionResult,
  buildProjectIndexContextDecisionInput,
  failOpenProjectIndexContextDecision,
  findReusableProjectIndexContextDecision,
  PROJECT_INDEX_CONTEXT_DECISION_ACTIVITY_KIND,
  PROJECT_INDEX_CONTEXT_DECISION_CRITERIA,
  PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID,
  projectIndexContextDecisionActivitySummary,
  resolveProjectIndexContextDecision,
  reuseProjectIndexContextDecision,
} from "./ProjectIndexContextDecision.ts";
import {
  PROJECT_INDEX_TASK_MAX_CHARACTERS,
  retrieveProjectIndexTurnContextCandidate,
  type ProjectIndexTurnContextCandidate,
} from "./ProjectIndexTurnContext.ts";

const projectId = ProjectId.make("project-1");
const decisionModelSelection = {
  instanceId: ProviderInstanceId.make("openrouter"),
  model: "native-decision-model",
};
const scope = {
  scopeId: "scope-1",
  projectId,
  workspaceFingerprint: "workspace-1",
};
const range = { startLine: 4, startColumn: 1, endLine: 4, endColumn: 20 };

function queryResult(options?: {
  readonly revision?: number;
  readonly withHit?: boolean;
  readonly entityName?: string;
}): ProjectIndexQueryResultV1 {
  const entityName = options?.entityName ?? "resolveConfig";
  return {
    version: 1,
    scope,
    revision: options?.revision ?? 7,
    operation: "task",
    summary: "Indexed source facts.",
    entities:
      options?.withHit === false
        ? []
        : [
            {
              id: entityName,
              filePath: `src/${entityName}.ts`,
              kind: "function",
              name: entityName,
              qualifiedName: entityName,
              signature: `${entityName}(): Config`,
              language: "typescript",
              range,
              sourceHash: `hash:${entityName}`,
              provenance: "compiler",
              freshness: "current",
              evidenceIds: [],
            },
          ],
    callsites: [],
    imports: [],
    modules: [],
    behaviors: [],
    flows: [],
    rules: [],
    evidence: [],
    gaps: [],
    coverage: EMPTY_PROJECT_INDEX_COVERAGE,
    nextCursor: null,
    truncated: false,
    estimatedTokens: 0,
  };
}

function candidate(overrides?: {
  readonly context?: string;
  readonly indexRevision?: number;
  readonly candidateHash?: string;
}): ProjectIndexTurnContextCandidate {
  return {
    context: overrides?.context ?? "<t3_project_knowledge>\nUseful fact\n</t3_project_knowledge>",
    hitCount: 1,
    fingerprint: {
      indexRevision: overrides?.indexRevision ?? 7,
      candidateHash: overrides?.candidateHash ?? "a".repeat(64),
    },
  };
}

it.effect("retrieves a bounded candidate after local Project Index lookup", () =>
  Effect.gen(function* () {
    let requestedText = "";
    const query = ProjectContextQuery.of({
      query: (input) => {
        requestedText = input.text ?? "";
        return Effect.succeed(queryResult());
      },
    });

    const result = yield* retrieveProjectIndexTurnContextCandidate(
      query,
      { projectId },
      "x".repeat(PROJECT_INDEX_TASK_MAX_CHARACTERS + 100),
    );

    expect(requestedText).toHaveLength(PROJECT_INDEX_TASK_MAX_CHARACTERS);
    expect(result).toMatchObject({
      hitCount: 1,
      fingerprint: { indexRevision: 7 },
    });
    expect(result?.context).toContain("resolveConfig");
    expect(result?.fingerprint.candidateHash).toMatch(/^[a-f0-9]{64}$/u);
  }),
);

it.effect("does not produce candidates for excluded turns, no hits, or retrieval failures", () =>
  Effect.gen(function* () {
    let queryCalls = 0;
    const successfulQuery = ProjectContextQuery.of({
      query: () => {
        queryCalls += 1;
        return Effect.succeed(queryResult({ withHit: false }));
      },
    });

    expect(
      yield* retrieveProjectIndexTurnContextCandidate(successfulQuery, { projectId }, "   "),
    ).toBeUndefined();
    expect(
      yield* retrieveProjectIndexTurnContextCandidate(successfulQuery, { projectId }, "  /status"),
    ).toBeUndefined();
    expect(queryCalls).toBe(0);
    expect(
      yield* retrieveProjectIndexTurnContextCandidate(
        successfulQuery,
        { projectId },
        "Explain the project",
      ),
    ).toBeUndefined();
    expect(queryCalls).toBe(1);

    const failingQuery = ProjectContextQuery.of({
      query: () =>
        Effect.fail(
          new ProjectIndexOperationError({
            code: "disabled",
            message: "Project Index is unavailable.",
            retryable: false,
          }),
        ),
    });
    expect(
      yield* retrieveProjectIndexTurnContextCandidate(
        failingQuery,
        { projectId },
        "Explain the project",
      ),
    ).toBeUndefined();
  }),
);

it("builds the fixed include-or-skip question with bounded private state", () => {
  const input = buildProjectIndexContextDecisionInput(
    { ...decisionModelSelection, model: "decision-model" },
    `${"p".repeat(PROJECT_INDEX_TASK_MAX_CHARACTERS)}secret-tail`,
    candidate({ context: `${"c".repeat(8_000)}secret-candidate-tail` }),
  );
  const state = JSON.parse(input.state) as Record<string, unknown>;

  expect(input.questions[PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID]?.criteria).toEqual(
    PROJECT_INDEX_CONTEXT_DECISION_CRITERIA,
  );
  expect(state).toEqual({
    currentUserPrompt: "p".repeat(PROJECT_INDEX_TASK_MAX_CHARACTERS),
    projectIndexCandidate: "c".repeat(8_000),
    indexRevision: 7,
    hitCount: 1,
  });
  expect(input.state).not.toContain("secret-tail");
  expect(input.state).not.toContain("secret-candidate-tail");
});

it("applies include and skip while persisting only privacy-safe diagnostics", () => {
  const source = candidate({ context: "PRIVATE INDEX CANDIDATE" });
  const included = applyProjectIndexContextDecisionResult(
    source,
    {
      model: "native-decision-model",
      answers: {
        [PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID]: {
          choice: "include",
          confidence: 0.8,
        },
      },
      usage: { inputTokens: 20, outputTokens: 1, totalTokens: 21 },
    },
    12.9,
  );
  const skipped = applyProjectIndexContextDecisionResult(
    source,
    {
      model: "native-decision-model",
      answers: {
        [PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID]: { choice: "skip" },
      },
    },
    9,
  );

  expect(included).toMatchObject({
    context: "PRIVATE INDEX CANDIDATE",
    reused: false,
    activity: {
      model: "native-decision-model",
      choice: "include",
      fallback: false,
      confidence: 0.8,
      durationMs: 12,
      usage: { totalTokens: 21 },
    },
  });
  expect(skipped).toMatchObject({
    context: undefined,
    activity: { choice: "skip", fallback: false },
  });
  expect(projectIndexContextDecisionActivitySummary(included.activity)).toBe(
    "Project Index context used",
  );
  expect(projectIndexContextDecisionActivitySummary(skipped.activity)).toBe(
    "Project Index context skipped",
  );
  expect(JSON.stringify(included.activity)).not.toContain("PRIVATE INDEX CANDIDATE");
});

it("fails open for decision errors and invalid choices", () => {
  const source = candidate();
  const failed = failOpenProjectIndexContextDecision(source, {
    model: "requested-model",
    durationMs: Number.POSITIVE_INFINITY,
  });
  const invalid = applyProjectIndexContextDecisionResult(
    source,
    {
      model: "returned-model",
      answers: {
        [PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID]: { choice: "unexpected" },
      },
    },
    5,
  );

  expect(failed).toMatchObject({
    context: source.context,
    activity: { model: "requested-model", choice: "include", fallback: true, durationMs: 0 },
  });
  expect(invalid).toMatchObject({
    context: source.context,
    activity: { model: "returned-model", choice: "include", fallback: true },
  });
  expect(projectIndexContextDecisionActivitySummary(failed.activity)).toContain("fallback");
});

it("reuses only a persisted decision with the same revision and candidate hash", () => {
  const source = candidate();
  const prior = applyProjectIndexContextDecisionResult(
    source,
    {
      model: "native-decision-model",
      answers: {
        [PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID]: { choice: "skip" },
      },
    },
    4,
  );
  const reused = reuseProjectIndexContextDecision(source, prior.activity);
  const fromActivities = findReusableProjectIndexContextDecision(
    source,
    [
      {
        kind: PROJECT_INDEX_CONTEXT_DECISION_ACTIVITY_KIND,
        turnId: "turn-original",
        payload: prior.activity,
      },
    ],
    "turn-original",
  );

  expect(reused).toMatchObject({ context: undefined, reused: true });
  expect(fromActivities).toMatchObject({ context: undefined, reused: true });
  expect(
    reuseProjectIndexContextDecision(candidate({ candidateHash: "b".repeat(64) }), prior.activity),
  ).toBeUndefined();
  expect(
    reuseProjectIndexContextDecision(candidate({ indexRevision: 8 }), prior.activity),
  ).toBeUndefined();
  expect(
    findReusableProjectIndexContextDecision(
      source,
      [
        {
          kind: PROJECT_INDEX_CONTEXT_DECISION_ACTIVITY_KIND,
          turnId: "turn-original",
          payload: prior.activity,
        },
      ],
      "different-turn",
    ),
  ).toBeUndefined();
});

it.effect("resolves through DecisionGeneration, reuses retries, and fails open on errors", () =>
  Effect.gen(function* () {
    const source = candidate();
    let calls = 0;
    const decisionGeneration = {
      decide: () => {
        calls += 1;
        return Effect.succeed({
          model: "native-decision-model",
          answers: {
            [PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID]: { choice: "skip" },
          },
        });
      },
      decideMany: () => Effect.succeed([]),
    };
    const resolved = yield* resolveProjectIndexContextDecision(decisionGeneration, {
      cwd: "/workspace",
      modelSelection: decisionModelSelection,
      task: "Explain the project",
      candidate: source,
    });
    const reused = yield* resolveProjectIndexContextDecision(decisionGeneration, {
      cwd: "/workspace",
      modelSelection: decisionModelSelection,
      task: "Explain the project",
      candidate: source,
      previousDecision: resolved.activity,
    });

    expect(resolved).toMatchObject({ context: undefined, reused: false });
    expect(reused).toMatchObject({ context: undefined, reused: true });
    expect(calls).toBe(1);

    const fallback = yield* resolveProjectIndexContextDecision(
      {
        decide: () =>
          Effect.fail(
            new DecisionGenerationError({
              operation: "decide",
              reason: "timeout",
              detail: "Timed out.",
            }),
          ),
        decideMany: () => Effect.succeed([]),
      },
      {
        cwd: "/workspace",
        modelSelection: decisionModelSelection,
        task: "Explain the project",
        candidate: source,
      },
    );
    expect(fallback).toMatchObject({
      context: source.context,
      activity: { choice: "include", fallback: true },
    });
  }),
);
