import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EMPTY_PROJECT_INDEX_COVERAGE,
  type OrchestrationV2AppThread,
  type OrchestrationV2ThreadShell,
  type ProjectIndexQueryResultV1,
  ProjectId,
  ProjectMemoryError,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";

import * as DecisionGeneration from "../decisionGeneration/DecisionGeneration.ts";
import { PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID } from "../projectIndexing/integration/ProjectIndexContextDecision.ts";
import { ProjectContextQuery } from "../projectIndexing/query/ProjectContextQuery.ts";
import * as ProjectMemoryStore from "../projectMemory/ProjectMemoryStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import { SkillEngine } from "../skills/Services/SkillEngine.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as TurnPromptContext from "./TurnPromptContext.ts";

const projectId = ProjectId.make("prompt-project");
const threadId = ThreadId.make("prompt-thread");
const decisionModel = { instanceId: ProviderInstanceId.make("codex"), model: "router" };
const rootLineage = { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId };
const childLineage = {
  parentThreadId: ThreadId.make("prompt-parent"),
  relationshipToParent: "subagent",
  rootThreadId: ThreadId.make("prompt-parent"),
};
const thread = (fields: Partial<OrchestrationV2AppThread> = {}) =>
  ({ id: threadId, projectId, lineage: rootLineage, ...fields }) as OrchestrationV2AppThread;
const shell = (id: string, fields: Partial<OrchestrationV2ThreadShell> = {}) =>
  ({
    id: ThreadId.make(id),
    projectId,
    lineage: rootLineage,
    activeRunId: null,
    deletedAt: null,
    archivedAt: null,
    ...fields,
  }) as OrchestrationV2ThreadShell;

const indexResult = {
  version: 1,
  scope: { scopeId: "scope", projectId, workspaceFingerprint: "fingerprint" },
  revision: 7,
  operation: "task",
  summary: "Indexed source facts.",
  entities: [
    {
      id: "resolveConfig",
      filePath: "src/resolveConfig.ts",
      kind: "function",
      name: "resolveConfig",
      qualifiedName: "resolveConfig",
      signature: "resolveConfig(): Config",
      language: "typescript",
      range: { startLine: 4, startColumn: 1, endLine: 4, endColumn: 20 },
      sourceHash: "hash",
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
} satisfies ProjectIndexQueryResultV1;

const memoryRead = {
  mode: "project",
  storage: "workspace",
  entries: [{ key: "build" }],
  markdown: "Use vp.\n",
} as never;

const coordinationSettings = {
  betterT3Environment: {
    version: 1,
    initialization: "existing-install-migration",
    flags: { "agent.projectCoordination": true },
  },
} as const;

const setup = (options: {
  readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
  readonly threads?: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly read?: ProjectMemoryStore.ProjectMemoryStoreShape["read"];
  readonly rewrite?: SkillEngine["Service"]["rewritePromptForProvider"];
  readonly decide?: DecisionGeneration.DecisionGeneration["Service"]["decide"];
}) => {
  const calls = { read: 0, settings: 0, query: 0, rewrite: 0, snapshot: 0 };
  const layer = TurnPromptContext.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(SkillEngine)({
          rewritePromptForProvider: (input) => {
            calls.rewrite += 1;
            return options.rewrite?.(input) ?? Effect.succeed(`expanded ${input.prompt}`);
          },
        }),
        Layer.mock(ProjectMemoryStore.ProjectMemoryStore)({
          read: (scope, request) => {
            calls.read += 1;
            return options.read?.(scope, request) ?? Effect.succeed(memoryRead);
          },
          getSettings: () => {
            calls.settings += 1;
            return Effect.succeed({
              projectId,
              settings: { memoryMode: "provider", allowAgentWrites: true },
            });
          },
        }),
        Layer.succeed(
          ProjectContextQuery,
          ProjectContextQuery.of({
            query: () => {
              calls.query += 1;
              return Effect.succeed(indexResult);
            },
          }),
        ),
        Layer.mock(DecisionGeneration.DecisionGeneration)({
          decide: options.decide ?? (() => Effect.die("decide unused")),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getShellSnapshot: () => {
            calls.snapshot += 1;
            return Effect.succeed({ threads: options.threads ?? [] } as never);
          },
        }),
        ServerSettings.layerTest(options.settings ?? {}).pipe(Layer.provide(NodeServices.layer)),
      ),
    ),
  );
  return { calls, layer };
};

const prepare = (
  input: Partial<Parameters<TurnPromptContext.TurnPromptContext["Service"]["prepare"]>[0]> = {},
) =>
  TurnPromptContext.TurnPromptContext.use((service) =>
    service.prepare({
      thread: thread(),
      workspaceRoot: "/prompt-project",
      cwd: "/prompt-project",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      text: "Fix the build",
      attachmentCount: 0,
      expandSkills: true,
      ...input,
    }),
  );

it.effect("gives a root chat its skills, memory and project index context", () => {
  const { calls, layer } = setup({});
  return Effect.gen(function* () {
    const prompt = yield* prepare();
    expect(prompt.text).toBe("expanded Fix the build");
    expect(prompt.memory).toBe("<t3code_project_memory>\nUse vp.\n</t3code_project_memory>");
    expect(prompt.projectContext).toContain("<t3_project_knowledge>");
    expect(prompt.projectMemoryMode).toBe("project");
    expect(calls).toMatchObject({ read: 1, settings: 0, query: 1, snapshot: 0 });
  }).pipe(Effect.provide(layer));
});

it.effect("reports an inactive memory mode without memory context", () => {
  const { layer } = setup({
    read: () => Effect.succeed({ mode: "off", storage: null, entries: [], markdown: "" } as never),
  });
  return Effect.gen(function* () {
    const prompt = yield* prepare();
    expect(prompt.memory).toBeUndefined();
    expect(prompt.projectMemoryMode).toBe("off");
  }).pipe(Effect.provide(layer));
});

it.effect.each([
  { name: "subagent", fields: { lineage: childLineage } },
  { name: "fetch worker", fields: { fetchWorker: { commandExecutionPolicy: "deny" } } },
] as const)("keeps root-chat context away from a $name", ({ fields }) => {
  const { calls, layer } = setup({
    settings: coordinationSettings,
    threads: [shell("peer", { activeRunId: "run" as never })],
  });
  return Effect.gen(function* () {
    const prompt = yield* prepare({ thread: thread(fields as never) });
    expect(prompt).toMatchObject({
      text: "expanded Fix the build",
      projectContext: undefined,
      memory: undefined,
      projectMemoryMode: "provider",
    });
    expect(calls).toMatchObject({ read: 0, settings: 1, query: 0, snapshot: 0 });
  }).pipe(Effect.provide(layer));
});

it.effect.each([
  {
    name: "another active root chat",
    settings: coordinationSettings,
    threads: [shell("peer", { activeRunId: "run" as never })],
    coordinated: true,
  },
  {
    name: "a running reply topic of this chat",
    settings: coordinationSettings,
    threads: [
      shell(threadId),
      shell("reply", {
        activeRunId: "run" as never,
        lineage: childLineage as never,
        messageReply: { sourceThreadId: threadId } as never,
      }),
    ],
    coordinated: true,
  },
  {
    name: "only a working subagent",
    settings: coordinationSettings,
    threads: [shell("child", { activeRunId: "run" as never, lineage: childLineage as never })],
    coordinated: false,
  },
  {
    name: "the coordination flag off",
    settings: {},
    threads: [shell("peer", { activeRunId: "run" as never })],
    coordinated: false,
  },
] as const)(
  "coordination instructions with $name: $coordinated",
  ({ settings, threads, coordinated }) => {
    const { layer } = setup({ settings, threads });
    return Effect.gen(function* () {
      const prompt = yield* prepare();
      expect(prompt.text.startsWith("<t3_project_agent_coordination>")).toBe(coordinated);
      expect(prompt.text.endsWith("expanded Fix the build")).toBe(true);
    }).pipe(Effect.provide(layer));
  },
);

it.effect("leaves provider commands and unexpandable prompts verbatim", () => {
  const { calls, layer } = setup({
    settings: coordinationSettings,
    threads: [shell("peer", { activeRunId: "run" as never })],
    rewrite: (input) => Effect.succeed(input.prompt),
  });
  return Effect.gen(function* () {
    expect((yield* prepare({ text: "/status" })).text).toBe("/status");
    const before = calls.rewrite;
    expect((yield* prepare({ text: "/compact", expandSkills: false })).text).toBe("/compact");
    expect(calls.rewrite).toBe(before);
  }).pipe(Effect.provide(layer));
});

it.effect("fails open to the plain prompt when every source breaks", () => {
  const failure = new ProjectMemoryError({ operation: "read", reason: "operation_failed" });
  const { layer } = setup({
    settings: coordinationSettings,
    read: () => Effect.fail(failure),
    rewrite: () => Effect.die("skills unavailable"),
  });
  return Effect.gen(function* () {
    const prompt = yield* prepare();
    expect(prompt.text).toBe("Fix the build");
    expect(prompt.memory).toBeUndefined();
    expect(prompt.projectMemoryMode).toBeUndefined();
  }).pipe(Effect.provide(layer));
});

const decision = (choice: "include" | "skip") => ({
  model: "router",
  answers: { [PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID]: { choice, confidence: 0.9 } },
});

it.effect.each([
  { choice: "include", expected: true },
  { choice: "skip", expected: false },
] as const)("honors a Project Index decision to $choice", ({ choice, expected }) => {
  const { layer } = setup({
    settings: { projectIndexingDecisionModelSelection: decisionModel },
    decide: () => Effect.succeed(decision(choice)),
  });
  return Effect.gen(function* () {
    const prompt = yield* prepare();
    expect(prompt.projectContext !== undefined).toBe(expected);
  }).pipe(Effect.provide(layer));
});

it.effect("keeps the candidate when the Project Index decision times out", () => {
  const { layer } = setup({
    settings: { projectIndexingDecisionModelSelection: decisionModel },
    decide: () => Effect.never,
  });
  return Effect.gen(function* () {
    const pending = yield* prepare().pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* TestClock.adjust("15 seconds");
    const prompt = yield* Fiber.join(pending);
    expect(prompt.projectContext).toContain("<t3_project_knowledge>");
  }).pipe(Effect.provide(layer));
});
