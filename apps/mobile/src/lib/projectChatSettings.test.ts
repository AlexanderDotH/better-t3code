import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  ProjectChatSettings as ProjectChatSettingsSchema,
  type ModelSelection,
  type ProjectChatSettings,
  type ServerConfig,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { ProjectChatSettingsThread } from "@t3tools/client-runtime/project-chat-settings";

import {
  resolveMobileComposerChatSettings,
  resolveMobileNewTaskChatSettings,
} from "./projectChatSettings";

const target = {
  environmentId: EnvironmentId.make("machine-one"),
  projectId: ProjectId.make("project-one"),
};
const modelSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex-work"),
  model: "gpt-test",
  options: [
    { id: "reasoningEffort", value: "xhigh" },
    { id: "serviceTier", value: "priority" },
    { id: "contextWindow", value: "1m" },
  ],
};
const defaults = {
  modelSelection: { ...modelSelection, instanceId: ProviderInstanceId.make("codex-personal") },
  runtimeMode: "full-access" as const,
  composerMode: "default" as const,
};
const config = {
  environment: {
    capabilities: {
      projectChatSettings: true,
      deepPlanning: { version: 1, sourceExport: true, sourceImport: true },
    },
  },
  providers: ["codex-work", "codex-personal"].map((instanceId) => ({
    instanceId,
    driver: "codex",
    enabled: true,
    installed: true,
    deepPlanning: { version: 1, structuredPlans: true, durableExecution: true },
    auth: { status: "authenticated" },
    models: [
      {
        slug: "gpt-test",
        name: "GPT Test",
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              type: "select",
              options: [
                { id: "low", label: "Low" },
                { id: "xhigh", label: "Extra high" },
              ],
            },
            {
              id: "serviceTier",
              label: "Speed",
              type: "select",
              options: [
                { id: "default", label: "Standard" },
                { id: "priority", label: "Fast" },
              ],
            },
            {
              id: "contextWindow",
              label: "Context",
              type: "select",
              options: [
                { id: "default", label: "Default" },
                { id: "1m", label: "1M" },
              ],
            },
          ],
        },
      },
    ],
  })),
} as unknown as ServerConfig;
const decodeProjectChatSettings = Schema.decodeUnknownSync(ProjectChatSettingsSchema);

function thread(overrides: Partial<ProjectChatSettingsThread> = {}): ProjectChatSettingsThread {
  return {
    ...target,
    id: ThreadId.make("thread-one"),
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "plan",
    latestUserMessageAt: "2026-10-16T10:00:00.000Z",
    createdAt: "2026-10-16T09:00:00.000Z",
    ...overrides,
  };
}

function resolve(
  input: {
    readonly remembered?: ProjectChatSettings;
    readonly threads?: ReadonlyArray<ProjectChatSettingsThread>;
    readonly draft?: Parameters<typeof resolveMobileComposerChatSettings>[0];
    readonly config?: ServerConfig;
  } = {},
) {
  return resolveMobileNewTaskChatSettings({
    target,
    config: input.config ?? config,
    defaults,
    remembered: input.remembered,
    threads: input.threads ?? [],
    draft: input.draft ?? {},
  });
}

describe("mobile project chat settings", () => {
  it("restores the exact provider instance and every supported option", () => {
    const remembered = {
      modelSelection,
      runtimeMode: "approval-required",
      composerMode: "deep-plan",
    } as const;
    const result = resolve({ remembered });

    expect(result.modelSelection).toEqual(modelSelection);
    expect(result.runtimeMode).toBe("approval-required");
    expect(result.composerMode).toBe("deep-plan");
    const restored = decodeProjectChatSettings(
      JSON.parse(JSON.stringify(result.preferredSettings)),
    );
    expect(resolve({ remembered: restored }).preferredSettings).toEqual(remembered);
  });

  it("bootstraps only a regular thread from the same environment and physical project", () => {
    const result = resolve({
      threads: [
        thread(),
        thread({
          id: ThreadId.make("other-project"),
          projectId: ProjectId.make("project-two"),
          latestUserMessageAt: "2026-10-16T12:00:00.000Z",
          modelSelection: defaults.modelSelection,
        }),
        thread({
          id: ThreadId.make("other-machine"),
          environmentId: EnvironmentId.make("machine-two"),
          latestUserMessageAt: "2026-10-16T13:00:00.000Z",
          modelSelection: defaults.modelSelection,
        }),
        thread({
          id: ThreadId.make("unused"),
          latestUserMessageAt: null,
          modelSelection: defaults.modelSelection,
        }),
      ],
    });

    expect(result.modelSelection).toEqual(modelSelection);
    expect(result.runtimeMode).toBe("approval-required");
    expect(result.composerMode).toBe("plan");
    expect(resolve({ remembered: {}, threads: [thread()] }).preferredSettings).toEqual(defaults);
  });

  it("keeps explicit draft choices ahead of later remembered changes", () => {
    const explicit = {
      modelSelection,
      runtimeMode: "approval-required",
      composerMode: "plan",
    } as const;
    expect(resolve({ remembered: defaults, draft: explicit }).preferredSettings).toEqual(explicit);
    expect(resolve({ remembered: defaults }).preferredSettings).toEqual(defaults);
  });

  it("falls back for an unavailable instance without replacing the saved choice", () => {
    const remembered = {
      modelSelection,
      runtimeMode: "approval-required",
      composerMode: "plan",
    } as const;
    const unavailableConfig = {
      ...config,
      providers: config.providers.filter(
        (provider) => provider.instanceId !== modelSelection.instanceId,
      ),
    };
    const result = resolve({ remembered, config: unavailableConfig });

    expect(result.modelSelection).toEqual(defaults.modelSelection);
    expect(result.preferredSettings).toEqual(remembered);
    expect(remembered.modelSelection).toEqual(modelSelection);
    expect(resolve({ remembered }).modelSelection).toEqual(modelSelection);
  });

  it("uses existing model option validation and keeps cleared options cleared in memory", () => {
    const remembered = {
      modelSelection: { ...modelSelection, options: [{ id: "serviceTier", value: "invalid" }] },
    };
    const result = resolve({ remembered });
    expect(result.modelSelection?.options).not.toContainEqual({
      id: "serviceTier",
      value: "invalid",
    });
    expect(result.preferredSettings.modelSelection).toEqual(remembered.modelSelection);
    expect(
      resolve({ remembered: { modelSelection: { ...modelSelection, options: [] } } })
        .preferredSettings.modelSelection?.options,
    ).toEqual([]);
  });

  it("clamps unsupported planning modes without changing the saved preference", () => {
    const unsupportedConfig = {
      ...config,
      providers: config.providers.map((provider) => ({
        ...provider,
        showInteractionModeToggle: false,
        deepPlanning: undefined,
      })),
    };
    for (const composerMode of ["plan", "deep-plan"] as const) {
      const remembered = { modelSelection, composerMode };
      const result = resolve({ remembered, config: unsupportedConfig });
      expect(result.composerMode).toBe("default");
      expect(result.preferredSettings.composerMode).toBe(composerMode);
      expect(resolve({ remembered }).composerMode).toBe(composerMode);
    }
  });

  it("uses the old defaults when the server does not support remembered settings", () => {
    const oldConfig = {
      ...config,
      environment: {
        ...config.environment,
        capabilities: { ...config.environment.capabilities, projectChatSettings: false },
      },
    };
    expect(
      resolve({
        remembered: { modelSelection, composerMode: "deep-plan" },
        threads: [thread()],
        config: oldConfig,
      }).preferredSettings,
    ).toEqual(defaults);
  });
});
