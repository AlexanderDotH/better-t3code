import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type OrchestrationThreadShell,
  type OrchestrationSubagentSummary,
  ProjectId,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
  WorkspaceContextUnavailableError,
  WorkspaceEditError,
  type WorkspaceContextInput,
  type WorkspaceContextResult,
  type WorkspaceEditInput,
  type WorkspaceEditResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  ProviderService,
  type ProviderAbortTarget,
} from "../../../provider/Services/ProviderService.ts";
import {
  makeReplyInvocation,
  makeReplySummary,
  replyContext,
} from "../../testFixtures/messageReply.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspaceContext from "../../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../../workspace/WorkspaceFileSystem.ts";
import { invokeWorkspaceContext, invokeWorkspaceEdit } from "./handlers.ts";

const threadId = ThreadId.make("thread-workspace-context");
const encodeJsonText = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const invocation = (capabilities: ReadonlySet<McpInvocationContext.McpCapability>) => ({
  environmentId: EnvironmentId.make("environment-workspace-context"),
  threadId,
  providerSessionId: "provider-session-workspace-context",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities,
  issuedAt: 1,
});

const result: WorkspaceContextResult = {
  queries: [],
  reads: [
    {
      status: "ok",
      path: "README.md",
      lineStart: 1,
      lineEnd: 1,
      text: "T3 Code",
      truncated: false,
    },
  ],
  truncated: false,
  warnings: [],
};

const input: WorkspaceContextInput = { reads: [{ path: "README.md" }] };

const makeLayer = (options?: {
  readonly contextMissing?: boolean;
  readonly worktreePath?: string | null;
  readonly replySummary?: OrchestrationSubagentSummary | null;
  readonly runtimeCurrent?: boolean;
}) => {
  const roots: Array<string> = [];
  const projection = Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
    getSubagentSummaryById: () =>
      Effect.succeed(
        Option.fromNullishOr(
          options?.replySummary === undefined ? makeReplySummary() : options.replySummary,
        ),
      ),
    getThreadWorkspaceContext: (requestedThreadId) => {
      expect(requestedThreadId).toBe(threadId);
      return Effect.succeed(
        options?.contextMissing === true
          ? Option.none()
          : Option.some({
              threadId,
              projectId: ProjectId.make("project-workspace-context"),
              workspaceRoot: "/workspace/project",
              worktreePath:
                options?.worktreePath === undefined
                  ? "/workspace/project/.t3/worktrees/feature"
                  : options.worktreePath,
            }),
      );
    },
  });
  const workspace = Layer.succeed(WorkspaceContext.WorkspaceContext, {
    execute: ({ workspaceRoot }) => {
      roots.push(workspaceRoot);
      return Effect.succeed(result);
    },
  });
  return {
    roots,
    layer: Layer.mergeAll(
      projection,
      workspace,
      Layer.mock(ProviderService)({
        isAbortTargetCurrent: () => Effect.succeed(options?.runtimeCurrent !== false),
      }),
    ),
  };
};

it.effect("resolves the authenticated thread worktree and never accepts a caller root", () => {
  const test = makeLayer();
  return Effect.gen(function* () {
    expect("workspaceRoot" in input).toBe(false);
    expect(yield* invokeWorkspaceContext(input)).toEqual(result);
    expect(test.roots).toEqual(["/workspace/project/.t3/worktrees/feature"]);
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview", "workspace"])),
    ),
    Effect.provide(test.layer),
  );
});

it.effect("falls back to the authenticated project's workspace root", () => {
  const test = makeLayer({ worktreePath: null });
  return Effect.gen(function* () {
    expect(yield* invokeWorkspaceContext(input)).toEqual(result);
    expect(test.roots).toEqual(["/workspace/project"]);
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview", "workspace"])),
    ),
    Effect.provide(test.layer),
  );
});

it.effect("fails closed when the authenticated thread is unavailable", () => {
  const test = makeLayer({ contextMissing: true });
  return Effect.gen(function* () {
    const error = yield* invokeWorkspaceContext(input).pipe(Effect.flip);
    expect(error).toBeInstanceOf(WorkspaceContextUnavailableError);
    expect(error.reason).toBe("thread_not_found");
    expect(test.roots).toEqual([]);
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview", "workspace"])),
    ),
    Effect.provide(test.layer),
  );
});

it.effect("rejects direct workspace invocation with a preview-only credential", () => {
  const test = makeLayer();
  return Effect.gen(function* () {
    const error = yield* invokeWorkspaceContext(input).pipe(Effect.flip);
    expect(error).toBeInstanceOf(WorkspaceContextUnavailableError);
    expect(error.reason).toBe("credential_not_authorized");
    expect(test.roots).toEqual([]);
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview"])),
    ),
    Effect.provide(test.layer),
  );
});

const editInput: WorkspaceEditInput = {
  changes: [
    {
      path: "src/example.ts",
      edits: [{ type: "write", mode: "upsert", content: "export {};\n" }],
    },
  ],
};

const editResult: WorkspaceEditResult = {
  changes: [{ path: "src/example.ts", action: "created", edit_count: 1 }],
};

const activeShell = (overrides?: {
  readonly runtimeMode?: OrchestrationThreadShell["runtimeMode"];
  readonly interactionMode?: OrchestrationThreadShell["interactionMode"];
  readonly activeTurn?: boolean;
  readonly providerInstanceId?: OrchestrationThreadShell["session"] extends infer Session
    ? Session extends { readonly providerInstanceId?: infer Instance }
      ? Instance
      : never
    : never;
}): OrchestrationThreadShell =>
  ({
    id: threadId,
    projectId: ProjectId.make("project-workspace-context"),
    title: "Workspace thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: overrides?.runtimeMode ?? "full-access",
    interactionMode: overrides?.interactionMode ?? "default",
    branch: null,
    worktreePath: "/workspace/project/.t3/worktrees/feature",
    latestTurn: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: {
      threadId,
      status: "running",
      providerName: "codex",
      providerInstanceId: overrides?.providerInstanceId ?? ProviderInstanceId.make("codex"),
      runtimeSessionId: RuntimeSessionId.make("runtime-workspace-context"),
      runtimeMode: overrides?.runtimeMode ?? "full-access",
      activeTurnId: overrides?.activeTurn === false ? null : TurnId.make("turn-workspace-context"),
      abortState: null,
      lastError: null,
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  }) as OrchestrationThreadShell;

const makeEditLayer = (options?: {
  readonly shell?: OrchestrationThreadShell | null;
  readonly worktreePath?: string | null;
  readonly contextMissing?: boolean;
  readonly editError?: WorkspaceEditError;
  readonly replySummary?: OrchestrationSubagentSummary | null;
  readonly runtimeCurrent?: boolean;
}) => {
  const requests: Array<{ readonly workspaceRoot: string; readonly input: WorkspaceEditInput }> =
    [];
  const leaseTargets: ProviderAbortTarget[] = [];
  const projection = Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
    getSubagentSummaryById: () =>
      Effect.succeed(
        Option.fromNullishOr(
          options?.replySummary === undefined ? makeReplySummary() : options.replySummary,
        ),
      ),
    getThreadWorkspaceContext: () =>
      Effect.succeed(
        options?.contextMissing === true
          ? Option.none()
          : Option.some({
              threadId,
              projectId: ProjectId.make("project-workspace-context"),
              workspaceRoot: "/workspace/project",
              worktreePath:
                options?.worktreePath === undefined
                  ? "/workspace/project/.t3/worktrees/feature"
                  : options.worktreePath,
            }),
      ),
    getThreadShellById: () =>
      Effect.succeed(
        Option.fromNullishOr(options?.shell === undefined ? activeShell() : options.shell),
      ),
  });
  const fileSystem = Layer.mock(WorkspaceFileSystem.WorkspaceFileSystem)({
    editFiles: (request) => {
      requests.push(request);
      return options?.editError ? Effect.fail(options.editError) : Effect.succeed(editResult);
    },
  });
  const provider = Layer.mock(ProviderService)({
    isAbortTargetCurrent: (target) =>
      Effect.sync(() => {
        leaseTargets.push(target);
        return options?.runtimeCurrent !== false;
      }),
  });
  return { requests, leaseTargets, layer: Layer.mergeAll(projection, fileSystem, provider) };
};

const writableInvocation = invocation(new Set(["workspace", "workspace-write"]));

it.effect("edits only the authenticated thread worktree during its active writable turn", () => {
  const test = makeEditLayer();
  return Effect.gen(function* () {
    const result = yield* invokeWorkspaceEdit(editInput);
    expect(result).toEqual(editResult);
    const encoded = encodeJsonText(result);
    expect(encoded).not.toContain("export {};");
    expect(Buffer.byteLength(encoded)).toBeLessThan(4_096);
    expect(test.requests).toEqual([
      { workspaceRoot: "/workspace/project/.t3/worktrees/feature", input: editInput },
    ]);
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, writableInvocation),
    Effect.provide(test.layer),
  );
});

it.effect("edits the project workspace when the authenticated thread has no worktree", () => {
  const test = makeEditLayer({ worktreePath: null });
  return Effect.gen(function* () {
    expect(yield* invokeWorkspaceEdit(editInput)).toEqual(editResult);
    expect(test.requests).toEqual([{ workspaceRoot: "/workspace/project", input: editInput }]);
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, writableInvocation),
    Effect.provide(test.layer),
  );
});

it.effect("returns a bounded structural failure without submitted file contents", () => {
  const secret = "SENSITIVE_EDIT_BODY";
  const input: WorkspaceEditInput = {
    changes: [
      {
        path: "src/example.ts",
        edits: [{ type: "write", mode: "upsert", content: secret }],
      },
    ],
  };
  const test = makeEditLayer({
    editError: new WorkspaceEditError({ reason: "ambiguous_match", path: "src/example.ts" }),
  });
  return Effect.gen(function* () {
    const error = yield* invokeWorkspaceEdit(input).pipe(Effect.flip);
    const encoded = encodeJsonText(error);
    expect(error.reason).toBe("ambiguous_match");
    expect(encoded).not.toContain(secret);
    expect(Buffer.byteLength(encoded)).toBeLessThan(4_096);
  }).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, writableInvocation),
    Effect.provide(test.layer),
  );
});

it.effect(
  "rejects missing, ended, stale-provider, read-only, and Plan-mode write invocations",
  () =>
    Effect.gen(function* () {
      const cases = [
        [makeEditLayer({ contextMissing: true }), writableInvocation, "thread_not_found"],
        [makeEditLayer({ shell: null }), writableInvocation, "thread_not_found"],
        [
          makeEditLayer({ shell: { ...activeShell(), session: null } }),
          writableInvocation,
          "inactive_turn",
        ],
        [
          makeEditLayer({ shell: activeShell({ activeTurn: false }) }),
          writableInvocation,
          "inactive_turn",
        ],
        [
          makeEditLayer({
            shell: activeShell({ providerInstanceId: ProviderInstanceId.make("claude") }),
          }),
          writableInvocation,
          "inactive_turn",
        ],
        [
          makeEditLayer({ shell: activeShell({ runtimeMode: "approval-required" }) }),
          writableInvocation,
          "runtime_mode_not_authorized",
        ],
        [
          makeEditLayer({ shell: activeShell({ interactionMode: "plan" }) }),
          writableInvocation,
          "plan_mode",
        ],
        [makeEditLayer(), invocation(new Set(["workspace"])), "credential_not_authorized"],
      ] as const;

      for (const [test, scopedInvocation, reason] of cases) {
        const error = yield* invokeWorkspaceEdit(editInput).pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, scopedInvocation),
          Effect.provide(test.layer),
          Effect.flip,
        );
        expect(error.reason).toBe(reason);
        expect(test.requests).toEqual([]);
      }
    }),
);

it.effect(
  "keeps a live reply writable in its captured workspace after the parent becomes idle or changes modes",
  () => {
    const parent = activeShell({
      runtimeMode: "approval-required",
      interactionMode: "plan",
      activeTurn: false,
    });
    const test = makeEditLayer({
      shell: { ...parent, session: null, worktreePath: "/workspace/new" },
    });
    return Effect.gen(function* () {
      expect(yield* invokeWorkspaceEdit(editInput)).toEqual(editResult);
      expect(test.requests).toEqual([
        { workspaceRoot: replyContext.workspacePath, input: editInput },
      ]);
      expect(test.leaseTargets).toEqual([
        {
          threadId: makeReplyInvocation(threadId).ownerThreadId,
          runtimeSessionId: replyContext.runtimeSessionId,
          providerInstanceId: ProviderInstanceId.make("codex"),
          turnId: null,
        },
      ]);
    }).pipe(
      Effect.provideService(
        McpInvocationContext.McpInvocationContext,
        makeReplyInvocation(threadId),
      ),
      Effect.provide(test.layer),
    );
  },
);

it.effect(
  "rejects stale reply runtimes, ended topics, and mismatched inherited context even with an active parent",
  () =>
    Effect.gen(function* () {
      for (const test of [
        makeEditLayer({ runtimeCurrent: false }),
        makeEditLayer({
          shell: { ...activeShell(), archivedAt: "2026-09-01T00:00:00.000Z" },
        }),
        makeEditLayer({ replySummary: null }),
        makeEditLayer({ replySummary: { ...makeReplySummary(), status: "completed" } }),
        makeEditLayer({
          replySummary: makeReplySummary({ ...replyContext, workspacePath: "/workspace/other" }),
        }),
      ]) {
        const error = yield* invokeWorkspaceEdit(editInput).pipe(
          Effect.provideService(
            McpInvocationContext.McpInvocationContext,
            makeReplyInvocation(threadId),
          ),
          Effect.provide(test.layer),
          Effect.flip,
        );
        expect(error.reason).toBe("inactive_turn");
        expect(test.requests).toEqual([]);
      }
    }),
);

it.effect(
  "enforces inherited reply approval and Plan modes after the parent becomes writable",
  () =>
    Effect.gen(function* () {
      for (const [context, reason] of [
        [
          { ...replyContext, runtimeMode: "approval-required" as const },
          "runtime_mode_not_authorized",
        ],
        [{ ...replyContext, interactionMode: "plan" as const }, "plan_mode"],
      ] as const) {
        const test = makeEditLayer({ replySummary: makeReplySummary(context) });
        const error = yield* invokeWorkspaceEdit(editInput).pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, {
            ...makeReplyInvocation(threadId),
            messageReply: context,
          }),
          Effect.provide(test.layer),
          Effect.flip,
        );
        expect(error.reason).toBe(reason);
        expect(test.requests).toEqual([]);
      }
    }),
);

it.effect(
  "keeps reply reads in the inherited workspace and rejects stale or mismatched reply credentials",
  () =>
    Effect.gen(function* () {
      const live = makeLayer({ worktreePath: "/workspace/new" });
      expect(
        yield* invokeWorkspaceContext(input).pipe(
          Effect.provideService(
            McpInvocationContext.McpInvocationContext,
            makeReplyInvocation(threadId),
          ),
          Effect.provide(live.layer),
        ),
      ).toEqual(result);
      expect(live.roots).toEqual([replyContext.workspacePath]);

      for (const rejected of [
        makeLayer({ runtimeCurrent: false }),
        makeLayer({ replySummary: null }),
        makeLayer({ replySummary: { ...makeReplySummary(), status: "completed" } }),
        makeLayer({
          replySummary: makeReplySummary({ ...replyContext, workspacePath: "/workspace/other" }),
        }),
      ]) {
        const error = yield* invokeWorkspaceContext(input).pipe(
          Effect.provideService(
            McpInvocationContext.McpInvocationContext,
            makeReplyInvocation(threadId),
          ),
          Effect.provide(rejected.layer),
          Effect.flip,
        );
        expect(error.reason).toBe("credential_not_authorized");
        expect(rejected.roots).toEqual([]);
      }
    }),
);
