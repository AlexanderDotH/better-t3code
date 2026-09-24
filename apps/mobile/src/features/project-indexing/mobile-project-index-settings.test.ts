import { deriveProjectIndexActions } from "@t3tools/client-runtime/project-indexing";
import {
  DEFAULT_PROJECT_INDEX_SETTINGS,
  EMPTY_PROJECT_INDEX_COVERAGE,
  EMPTY_PROJECT_INDEX_USAGE,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ProjectIndexSettings,
  type ProjectIndexStatusV1,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  findMobileProjectIndexProject,
  mobileProjectIndexDefaults,
  mobileProjectIndexEffectiveSettings,
  mobileProjectIndexStatusWithDefaults,
  supportsMobileStaticProjectIndex,
} from "./mobile-project-index-settings";

const firstEnvironment = EnvironmentId.make("environment-a");
const secondEnvironment = EnvironmentId.make("environment-b");
const projectId = ProjectId.make("project-1");
const defaultModel = { instanceId: ProviderInstanceId.make("provider"), model: "default" };
const overrideModel = { ...defaultModel, model: "override" };
const timestamp = "2026-09-21T00:00:00.000Z";
const raw: ProjectIndexSettings = {
  ...DEFAULT_PROJECT_INDEX_SETTINGS,
  enabled: true,
  autoRefresh: false,
  reviewEnabled: true,
};
const status = (settings: ProjectIndexSettings = raw): ProjectIndexStatusV1 => ({
  version: 1,
  scope: { scopeId: "scope-1", projectId, workspaceFingerprint: "workspace-1" },
  revision: 1,
  state: "ready",
  settings,
  job: null,
  coverage: EMPTY_PROJECT_INDEX_COVERAGE,
  gaps: [],
  updatedAt: timestamp,
});

describe("mobile project indexing selection", () => {
  const projects = [
    { environmentId: firstEnvironment, id: projectId },
    { environmentId: secondEnvironment, id: projectId },
  ];

  it("requires an explicit environment and project without a first-project fallback", () => {
    expect(findMobileProjectIndexProject(projects, undefined)).toBeNull();
    expect(findMobileProjectIndexProject(projects, { environmentId: firstEnvironment })).toBeNull();
    expect(findMobileProjectIndexProject(projects, { projectId })).toBeNull();
    expect(
      findMobileProjectIndexProject(projects, {
        environmentId: firstEnvironment,
        projectId: "missing",
      }),
    ).toBeNull();
    expect(
      findMobileProjectIndexProject(projects, { environmentId: "missing", projectId }),
    ).toBeNull();
  });

  it("keeps identical project IDs bound to the requested environment", () => {
    expect(
      findMobileProjectIndexProject(projects, { environmentId: secondEnvironment, projectId }),
    ).toBe(projects[1]);
    expect(
      findMobileProjectIndexProject([projects[0]!], {
        environmentId: secondEnvironment,
        projectId,
      }),
    ).toBeNull();
  });
});

describe("mobile project indexing defaults", () => {
  it("requires static indexing capability before offering writes", () => {
    expect(supportsMobileStaticProjectIndex(undefined)).toBe(false);
    expect(supportsMobileStaticProjectIndex(2)).toBe(false);
    expect(supportsMobileStaticProjectIndex(3)).toBe(true);
  });
  it("inherits a default, keeps an override, and resets only that project's override", () => {
    const defaults = { enabled: true, modelSelection: defaultModel };
    const inherited = mobileProjectIndexStatusWithDefaults(status(), defaults);
    const overridden = mobileProjectIndexStatusWithDefaults(
      status({ ...raw, modelSelection: overrideModel }),
      defaults,
    );
    expect(mobileProjectIndexEffectiveSettings(inherited).modelSelection).toEqual(defaultModel);
    expect(mobileProjectIndexEffectiveSettings(overridden).modelSelection).toEqual(overrideModel);
    const reset = { ...overridden, settings: { ...overridden.settings, modelSelection: null } };
    expect(mobileProjectIndexEffectiveSettings(reset).modelSelection).toEqual(defaultModel);
    expect(overridden.settings.modelSelection).toEqual(overrideModel);
    expect(inherited.settings).toBe(raw);
  });

  it("gates work without rewriting project opt-ins, automatic updates, reviews or overrides", () => {
    const project = status({ ...raw, modelSelection: overrideModel });
    const disabled = mobileProjectIndexStatusWithDefaults(project, {
      enabled: false,
      modelSelection: defaultModel,
    });
    expect(mobileProjectIndexEffectiveSettings(disabled)).toEqual({
      ...project.settings,
      enabled: false,
    });
    expect(disabled.settings).toBe(project.settings);
    expect(project.settings).toEqual({ ...raw, modelSelection: overrideModel });
    expect(deriveProjectIndexActions(disabled).canStart).toBe(false);
    expect(deriveProjectIndexActions(disabled).canRebuild).toBe(false);
    expect(
      mobileProjectIndexEffectiveSettings(
        mobileProjectIndexStatusWithDefaults(status(DEFAULT_PROJECT_INDEX_SETTINGS), {
          enabled: true,
          modelSelection: defaultModel,
        }),
      ).enabled,
    ).toBe(false);
  });

  it("uses global fields only with the defaults capability and preserves older per-project behavior", () => {
    const config = {
      environment: { capabilities: {} },
      settings: {
        projectIndexingEnabled: false,
        projectIndexingDefaultModelSelection: defaultModel,
      },
    };
    expect(mobileProjectIndexDefaults(config)).toBeUndefined();
    const legacy = status({ ...raw, modelSelection: overrideModel });
    expect(
      mobileProjectIndexEffectiveSettings(
        mobileProjectIndexStatusWithDefaults(legacy, mobileProjectIndexDefaults(config)),
      ),
    ).toEqual(legacy.settings);
    expect(
      mobileProjectIndexDefaults({
        ...config,
        environment: { capabilities: { projectIndexingDefaultsVersion: 1 } },
      }),
    ).toEqual({ enabled: false, modelSelection: defaultModel });
  });

  it("keeps pause and resume actions available without an analysis model", () => {
    const paused: ProjectIndexStatusV1 = {
      ...status(),
      state: "paused",
      job: {
        id: "job-1",
        generationId: "generation-1",
        kind: "initial",
        state: "paused",
        phase: "extraction",
        revision: 1,
        modelSelection: null,
        usage: EMPTY_PROJECT_INDEX_USAGE,
        updatedAt: timestamp,
        units: { pending: 1, running: 0, completed: 0, failed: 0, stale: 0, cancelled: 0 },
      },
    };
    const enabled = mobileProjectIndexStatusWithDefaults(paused, {
      enabled: true,
      modelSelection: null,
    });
    expect(deriveProjectIndexActions(enabled).canResume).toBe(true);
    const off = mobileProjectIndexStatusWithDefaults(enabled, {
      enabled: false,
      modelSelection: null,
    });
    expect(deriveProjectIndexActions(off).canResume).toBe(false);
    expect(deriveProjectIndexActions(off).canCancel).toBe(true);
  });
});
