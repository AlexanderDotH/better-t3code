import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ServerConfig,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  projectChatSettingsSnapshot,
  resolveProjectChatSettings,
  type ProjectChatSettingsThread,
  type ResolvedProjectChatSettings,
} from "./projectChatSettings.ts";
import { createProjectChatSettingsState } from "./state/projectChatSettings.ts";
import type { AtomCommandResult } from "./state/runtime.ts";

const target = {
  environmentId: EnvironmentId.make("environment"),
  projectId: ProjectId.make("project"),
};
const defaults: ResolvedProjectChatSettings = {
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "default-model" },
  runtimeMode: "full-access",
  composerMode: "default",
};
const remembered: ResolvedProjectChatSettings = {
  modelSelection: {
    instanceId: ProviderInstanceId.make("second-codex"),
    model: "remembered-model",
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "priority" },
      { id: "contextWindow", value: "1m" },
      { id: "custom-toggle", value: true },
    ],
  },
  runtimeMode: "approval-required",
  composerMode: "deep-plan",
};

function thread(overrides: Partial<ProjectChatSettingsThread> = {}): ProjectChatSettingsThread {
  return {
    ...target,
    id: ThreadId.make("thread"),
    modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "legacy-model" },
    runtimeMode: "approval-required",
    interactionMode: "plan",
    createdAt: "2026-09-01T00:00:00.000Z",
    latestUserMessageAt: "2026-09-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveProjectChatSettings", () => {
  it("prefers a remembered complete selection over legacy threads and defaults", () => {
    expect(
      resolveProjectChatSettings({ target, remembered, threads: [thread()], defaults }),
    ).toEqual(remembered);
  });

  it("uses defaults for absent remembered fields, including an intentional empty record", () => {
    expect(
      resolveProjectChatSettings({ target, remembered: {}, threads: [thread()], defaults }),
    ).toEqual(defaults);
    expect(
      resolveProjectChatSettings({
        target,
        remembered: { runtimeMode: "approval-required" },
        threads: [thread()],
        defaults,
      }),
    ).toEqual({ ...defaults, runtimeMode: "approval-required" });
  });

  it("bootstraps only from used threads in the physical target project and environment", () => {
    const unrelatedEnvironment = thread({
      environmentId: EnvironmentId.make("other-environment"),
      latestUserMessageAt: "2026-10-10T00:00:00.000Z",
    });
    const unrelatedProject = thread({
      projectId: ProjectId.make("other-project"),
      latestUserMessageAt: "2026-10-11T00:00:00.000Z",
    });
    const unused = thread({
      id: ThreadId.make("unused"),
      createdAt: "2026-10-12T00:00:00.000Z",
      latestUserMessageAt: null,
    });
    const recentlyUsed = thread({
      id: ThreadId.make("used"),
      latestUserMessageAt: "2026-10-01T00:00:00.000Z",
      modelSelection: remembered.modelSelection,
    });
    const backgroundUpdated = {
      ...thread({ id: ThreadId.make("background-updated") }),
      updatedAt: "2026-10-15T00:00:00.000Z",
      backgroundLiveness: "working",
    };

    expect(
      resolveProjectChatSettings({
        target,
        remembered: undefined,
        defaults,
        threads: [unrelatedEnvironment, unrelatedProject, unused, recentlyUsed, backgroundUpdated],
      }),
    ).toEqual({ ...remembered, composerMode: "plan" });
  });

  it("breaks usage ties by creation time then id independently of input order", () => {
    const first = thread({
      id: ThreadId.make("a"),
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    const second = thread({
      id: ThreadId.make("a"),
      createdAt: "2026-09-02T00:00:00.000Z",
    });
    const winner = thread({
      id: ThreadId.make("b"),
      createdAt: second.createdAt,
      modelSelection: remembered.modelSelection,
      composerMode: "deep-plan",
    });
    const threads = [winner, first, second];
    for (const candidates of [threads, threads.toReversed()]) {
      expect(
        resolveProjectChatSettings({
          target,
          remembered: undefined,
          threads: candidates,
          defaults,
        }),
      ).toEqual(remembered);
    }
  });

  it("preserves complete model options and replaces cleared options without merging", () => {
    const cleared = {
      ...remembered,
      modelSelection: { ...remembered.modelSelection, options: [] },
    };
    expect(
      resolveProjectChatSettings({
        target,
        remembered: cleared,
        threads: [thread({ modelSelection: remembered.modelSelection })],
        defaults: remembered,
      }),
    ).toEqual(cleared);
    const noOptions = {
      ...remembered,
      modelSelection: {
        instanceId: remembered.modelSelection.instanceId,
        model: remembered.modelSelection.model,
      },
    };
    expect(
      resolveProjectChatSettings({
        target,
        remembered: noOptions,
        threads: [],
        defaults: remembered,
      }),
    ).toEqual(noOptions);
  });

  it("keeps modes available before a model catalog or default selection exists", () => {
    expect(
      resolveProjectChatSettings({
        target,
        remembered: { composerMode: "deep-plan", runtimeMode: "approval-required" },
        threads: [],
        defaults: { ...defaults, modelSelection: null },
      }),
    ).toEqual({
      modelSelection: null,
      runtimeMode: "approval-required",
      composerMode: "deep-plan",
    });
  });

  it("copies only composer settings from a rich legacy thread", () => {
    const richThread = {
      ...thread(),
      messages: [{ role: "user", text: "old prompt" }],
      attachments: ["old-file"],
      branch: "old-branch",
      worktreePath: "/old-worktree",
      session: { id: "old-session" },
      deepPlan: { sources: ["old-source"] },
    };
    expect(
      resolveProjectChatSettings({
        target,
        remembered: undefined,
        threads: [richThread],
        defaults,
      }),
    ).toEqual({
      modelSelection: richThread.modelSelection,
      runtimeMode: richThread.runtimeMode,
      composerMode: "plan",
    });
    const snapshot = projectChatSettingsSnapshot({
      ...remembered,
      ...richThread,
      composerMode: "plan",
    });
    expect(Object.keys(snapshot).sort()).toEqual(["composerMode", "modelSelection", "runtimeMode"]);
    expect(snapshot.modelSelection).not.toBe(richThread.modelSelection);
    const copied = projectChatSettingsSnapshot(remembered);
    expect(copied.modelSelection.options).toEqual(remembered.modelSelection.options);
    expect(copied.modelSelection.options).not.toBe(remembered.modelSelection.options);
  });
});

function createStateHarness(supported = true) {
  const configValueAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<ServerConfig | null>({
      environment: { capabilities: { projectChatSettings: supported } },
      settings: DEFAULT_SERVER_SETTINGS,
    } as unknown as ServerConfig).pipe(Atom.keepAlive),
  );
  const requests: Array<{
    readonly environmentId: EnvironmentId;
    readonly input: { readonly patch: ServerSettingsPatch };
    readonly resolve: (result: AtomCommandResult<ServerSettings, Error>) => void;
  }> = [];
  const state = createProjectChatSettingsState<Error>({
    configValueAtom,
    updateSettings: {
      label: "test:update-settings",
      run: (_registry, request) => {
        const deferred = Promise.withResolvers<AtomCommandResult<ServerSettings, Error>>();
        requests.push({ ...request, resolve: deferred.resolve });
        return deferred.promise;
      },
    },
  });
  const registry = AtomRegistry.make();
  const publish = (
    settings: ServerSettings["projectChatSettings"],
    environmentId = target.environmentId,
  ) => {
    const config = registry.get(configValueAtom(environmentId))!;
    registry.set(configValueAtom(environmentId), {
      ...config,
      settings: { ...config.settings, projectChatSettings: settings },
    });
  };
  return { ...state, registry, requests, publish, configValueAtom };
}

describe("project chat settings writes", () => {
  it("exposes pending settings synchronously, isolated by project and environment", async () => {
    const harness = createStateHarness();
    try {
      harness.publish({ [target.projectId]: {} });
      const result = harness.rememberProjectChatSettings.run(harness.registry, {
        ...target,
        settings: remembered,
      });
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual(
        remembered,
      );
      expect(harness.requests[0]?.input.patch.projectChatSettings).toEqual({
        [target.projectId]: remembered,
      });
      expect(
        harness.registry.get(
          harness.projectChatSettingsValueAtom({ ...target, projectId: ProjectId.make("other") }),
        ),
      ).toBeUndefined();
      expect(
        harness.registry.get(
          harness.projectChatSettingsValueAtom({
            ...target,
            environmentId: EnvironmentId.make("other"),
          }),
        ),
      ).toBeUndefined();
      harness.publish({ [target.projectId]: remembered });
      harness.requests[0]!.resolve(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
      expect(AsyncResult.isSuccess(await result)).toBe(true);
      harness.publish({ [target.projectId]: {} });
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual({});
    } finally {
      harness.registry.dispose();
    }
  });

  it("keeps a newer pending selection when an older write is acknowledged", async () => {
    const harness = createStateHarness();
    try {
      const first = harness.rememberProjectChatSettings.run(harness.registry, {
        ...target,
        settings: defaults,
      });
      const second = harness.rememberProjectChatSettings.run(harness.registry, {
        ...target,
        settings: remembered,
      });
      expect(harness.requests).toHaveLength(1);
      harness.publish({ [target.projectId]: defaults });
      harness.requests[0]!.resolve(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
      await first;
      expect(harness.requests).toHaveLength(2);
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual(
        remembered,
      );
      harness.requests[1]!.resolve(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
      await second;
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual(
        remembered,
      );
      harness.publish({ [target.projectId]: remembered });
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual(
        remembered,
      );
      harness.publish({ [target.projectId]: defaults });
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual(defaults);
    } finally {
      harness.registry.dispose();
    }
  });

  it("yields to a newer server choice when the stream skips the acknowledged selection", async () => {
    const harness = createStateHarness();
    try {
      harness.publish({ [target.projectId]: defaults });
      const result = harness.rememberProjectChatSettings.run(harness.registry, {
        ...target,
        settings: remembered,
      });
      const laterDeviceChoice = { ...defaults, composerMode: "plan" as const };
      harness.publish({ [target.projectId]: laterDeviceChoice });
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual(
        remembered,
      );
      harness.requests[0]!.resolve(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
      await result;
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual(
        laterDeviceChoice,
      );
    } finally {
      harness.registry.dispose();
    }
  });

  it("restores server authority after failure without clearing a newer selection", async () => {
    const harness = createStateHarness();
    try {
      harness.publish({ [target.projectId]: defaults });
      const first = harness.rememberProjectChatSettings.run(harness.registry, {
        ...target,
        settings: defaults,
      });
      const second = harness.rememberProjectChatSettings.run(harness.registry, {
        ...target,
        settings: remembered,
      });
      harness.requests[0]!.resolve(AsyncResult.failure(Cause.fail(new Error("first failed"))));
      await first;
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual(
        remembered,
      );
      harness.requests[1]!.resolve(AsyncResult.failure(Cause.fail(new Error("second failed"))));
      expect(AsyncResult.isFailure(await second)).toBe(true);
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual(defaults);
    } finally {
      harness.registry.dispose();
    }
  });

  it("does not send unknown patches to older environments", async () => {
    const harness = createStateHarness(false);
    try {
      const result = await harness.rememberProjectChatSettings.run(harness.registry, {
        ...target,
        settings: remembered,
      });
      expect(AsyncResult.isSuccess(result)).toBe(true);
      expect(harness.requests).toEqual([]);
      expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toBeUndefined();
    } finally {
      harness.registry.dispose();
    }
  });

  it.each(["unsupported", "unavailable"] as const)(
    "skips a queued write when its environment becomes %s before execution",
    async (connectionState) => {
      const harness = createStateHarness();
      try {
        harness.publish({ [target.projectId]: defaults });
        const first = harness.rememberProjectChatSettings.run(harness.registry, {
          ...target,
          settings: defaults,
        });
        const second = harness.rememberProjectChatSettings.run(harness.registry, {
          ...target,
          settings: remembered,
        });
        expect(harness.requests).toHaveLength(1);
        const source = harness.configValueAtom(target.environmentId);
        const supportedConfig = harness.registry.get(source)!;
        harness.registry.set(
          source,
          connectionState === "unavailable"
            ? null
            : {
                ...supportedConfig,
                environment: {
                  ...supportedConfig.environment,
                  capabilities: {
                    ...supportedConfig.environment.capabilities,
                    projectChatSettings: false,
                  },
                },
              },
        );
        harness.requests[0]!.resolve(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
        const results = await Promise.all([first, second]);
        expect(results.every(AsyncResult.isSuccess)).toBe(true);
        expect(harness.requests).toHaveLength(1);
        harness.registry.set(source, supportedConfig);
        expect(harness.registry.get(harness.projectChatSettingsValueAtom(target))).toEqual(
          defaults,
        );
      } finally {
        harness.registry.dispose();
      }
    },
  );
});
