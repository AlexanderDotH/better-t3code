import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ExecutionEnvironmentCapabilities,
  type ModelSelection,
  type ProjectChatSettings,
  type ScopedProjectRef,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { ProjectChatSettingsThread } from "@t3tools/client-runtime/project-chat-settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

interface TestServerConfig {
  readonly settings: ServerSettings;
  readonly providers: ServerProvider[];
  readonly environment: { readonly capabilities: ExecutionEnvironmentCapabilities };
}

const testState = vi.hoisted(() => {
  const configs = new Map<EnvironmentId, TestServerConfig>();
  const remembered = new Map<string, ProjectChatSettings>();
  const projects: Array<{
    id: ProjectId;
    environmentId: EnvironmentId;
    workspaceRoot: string;
    defaultModelSelection: null;
    defaultThreadEnvMode: null;
  }> = [];
  const shells: ProjectChatSettingsThread[] = [];
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} as Record<string, string> }],
    },
    navigate: vi.fn(async (input: { params: { draftId: string } }) => {
      router.state.location.href = `/draft/${input.params.draftId}`;
      router.state.matches = [{ params: input.params }];
    }),
  };
  const key = (ref: ScopedProjectRef) => `${ref.environmentId}/${ref.projectId}`;
  return {
    configs,
    remembered,
    projects,
    shells,
    router,
    key,
    nextId: 0,
    logicalProjectKey: null as string | null,
    projectFileRead: Promise.resolve<null>(null),
    remember: vi.fn(
      (_registry: unknown, input: ScopedProjectRef & { settings: ProjectChatSettings }) => {
        remembered.set(key(input), input.settings);
        return new Promise<void>(() => undefined);
      },
    ),
  };
});

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => testState.configs }));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: "server-configs",
  serverEnvironment: {
    projectChatSettingsValueAtom: (ref: ScopedProjectRef) => () =>
      testState.remembered.get(testState.key(ref)) ??
      testState.configs.get(ref.environmentId)?.settings.projectChatSettings[ref.projectId],
    rememberProjectChatSettings: { run: testState.remember },
  },
}));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (atom: unknown) => (typeof atom === "function" ? atom() : testState.configs),
  },
}));
vi.mock("../state/entities", () => ({
  readProjects: () => testState.projects,
  readThreadShell: (ref: { environmentId: EnvironmentId; threadId: ThreadId }) =>
    testState.shells.find(
      (shell) => shell.environmentId === ref.environmentId && shell.id === ref.threadId,
    ) ?? null,
  readThreadShells: () => testState.shells,
  useProjects: () => [],
  useThread: () => null,
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: (project: { id: ProjectId; environmentId: EnvironmentId }) =>
    testState.logicalProjectKey ?? `${project.environmentId}:${project.id}`,
  getProjectOrderKey: () => "project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => `draft-${++testState.nextId}`,
  newThreadId: () => `thread-${testState.nextId}`,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => testState.projectFileRead,
}));
vi.mock("./useSettings", () => ({
  useClientSettings: (selector?: (settings: { planModeEnabled: boolean }) => unknown) =>
    selector?.({ planModeEnabled: true }) ?? {},
}));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "project",
  useUiStateStore: () => [],
}));

import { createEmptyThreadDraft, DraftId, useComposerDraftStore } from "../composerDraftStore";
import {
  readComposerProjectChatSettings,
  resolveAvailableComposerMode,
} from "../lib/chatThreadActions";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import { useNewThreadHandler } from "./useHandleNewThread";

const ENVIRONMENT = EnvironmentId.make("environment-local");
const REMOTE_ENVIRONMENT = EnvironmentId.make("environment-remote");
const PROJECT = ProjectId.make("project-a");
const OTHER_PROJECT = ProjectId.make("project-b");
const TARGET = scopeProjectRef(ENVIRONMENT, PROJECT);
const DEFAULT_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "project-default",
};
const REMEMBERED_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex-work"),
  model: "chosen-model",
  options: [
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "fast" },
    { id: "contextWindow", value: "1048576" },
  ],
};
const REMEMBERED_SETTINGS = {
  modelSelection: REMEMBERED_SELECTION,
  runtimeMode: "auto-accept-edits",
  composerMode: "deep-plan",
} as const;

function provider(instanceId: ProviderInstanceId): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-16T10:00:00.000Z",
    models: [
      {
        slug: DEFAULT_SELECTION.model,
        name: "Default",
        isCustom: false,
        isDefault: true,
        capabilities: {},
      },
      { slug: REMEMBERED_SELECTION.model, name: "Chosen", isCustom: false, capabilities: {} },
    ],
    slashCommands: [],
    skills: [],
    deepPlanning: { version: 1, structuredPlans: true, durableExecution: true },
  };
}

function shell(
  ref: ScopedProjectRef,
  input: Partial<Omit<ProjectChatSettingsThread, "environmentId" | "projectId">> = {},
): ProjectChatSettingsThread {
  return {
    environmentId: ref.environmentId,
    projectId: ref.projectId,
    id: ThreadId.make(`previous-${testState.shells.length}`),
    modelSelection: REMEMBERED_SELECTION,
    runtimeMode: "full-access",
    interactionMode: "plan",
    createdAt: "2026-10-15T10:00:00.000Z",
    latestUserMessageAt: "2026-10-16T10:00:00.000Z",
    ...input,
  };
}

function addProject(ref: ScopedProjectRef) {
  testState.projects.push({
    id: ref.projectId,
    environmentId: ref.environmentId,
    workspaceRoot: `/projects/${ref.projectId}`,
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
  });
}

function reset() {
  testState.configs.clear();
  testState.remembered.clear();
  testState.projects.length = 0;
  testState.shells.length = 0;
  testState.nextId = 0;
  testState.logicalProjectKey = null;
  testState.projectFileRead = Promise.resolve(null);
  testState.router.state.location.href = "/";
  testState.router.state.matches = [{ params: {} }];
  testState.router.navigate.mockClear();
  testState.remember.mockClear();
  for (const environmentId of [ENVIRONMENT, REMOTE_ENVIRONMENT]) {
    testState.configs.set(environmentId, {
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        defaultModelSelection: DEFAULT_SELECTION,
        defaultRuntimeMode: "approval-required",
        defaultThreadEnvMode: "local",
      },
      providers: [
        provider(DEFAULT_SELECTION.instanceId),
        provider(REMEMBERED_SELECTION.instanceId),
      ],
      environment: {
        capabilities: {
          repositoryIdentity: false,
          midChatProviderSwitching: false,
          projectChatSettings: true,
          deepPlanning: { version: 1, sourceExport: true, sourceImport: true },
        },
      },
    });
  }
  addProject(TARGET);
  addProject(scopeProjectRef(ENVIRONMENT, OTHER_PROJECT));
  addProject(scopeProjectRef(REMOTE_ENVIRONMENT, PROJECT));
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
    backgroundSubmissionThreadKeys: {},
    rewindingThreadKeys: new Set(),
  });
}

describe("new threads with remembered project chat settings", () => {
  beforeEach(reset);
  afterEach(reset);

  it("uses a model change before the settings save is acknowledged, without copying composer content", async () => {
    const source = shell(TARGET);
    testState.shells.push(source);
    testState.router.state.matches = [
      { params: { environmentId: ENVIRONMENT, threadId: source.id } },
    ];
    const sourceRef = scopeThreadRef(ENVIRONMENT, source.id);
    const store = useComposerDraftStore.getState();
    store.setPrompt(sourceRef, "Keep this unsent prompt");
    const file = new File(["private attachment"], "source.txt", { type: "text/plain" });
    store.addFiles(sourceRef, [
      {
        type: "file",
        id: "source-attachment",
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        file,
      },
    ]);
    store.setTerminalContexts(sourceRef, [
      {
        id: "source-terminal",
        threadId: source.id,
        terminalId: "terminal-source",
        terminalLabel: "Terminal",
        lineStart: 1,
        lineEnd: 1,
        text: "private context",
        createdAt: "2026-10-16T10:00:00.000Z",
      },
    ]);
    store.setDeepPlanSourceRefs(sourceRef, [
      { environmentId: ENVIRONMENT, projectId: PROJECT, threadId: source.id },
    ]);
    store.setModelSelection(sourceRef, REMEMBERED_SELECTION, {
      explicit: true,
      replaceOptions: true,
    });
    store.setRuntimeMode(sourceRef, REMEMBERED_SETTINGS.runtimeMode);
    store.setComposerMode(sourceRef, REMEMBERED_SETTINGS.composerMode);
    const sourceComposer = store.getComposerDraft(sourceRef);
    const snapshot = readComposerProjectChatSettings({
      draft: sourceComposer,
      fallback: {
        modelSelection: DEFAULT_SELECTION,
        runtimeMode: "approval-required",
        composerMode: "default",
      },
    });
    void serverEnvironment.rememberProjectChatSettings.run(appAtomRegistry, {
      ...TARGET,
      settings: snapshot,
    });

    const opened = await useNewThreadHandler()(TARGET);
    const draft = store.getComposerDraft(opened!.draftId);

    expect(
      testState.configs.get(ENVIRONMENT)?.settings.projectChatSettings[PROJECT],
    ).toBeUndefined();
    expect(draft).toMatchObject({
      ...createEmptyThreadDraft(),
      activeProvider: REMEMBERED_SELECTION.instanceId,
      modelSelectionByProvider: { [REMEMBERED_SELECTION.instanceId]: REMEMBERED_SELECTION },
      runtimeMode: REMEMBERED_SETTINGS.runtimeMode,
      composerMode: "deep-plan",
      interactionMode: "plan",
    });
    expect(store.getDraftSession(opened!.draftId)).toMatchObject({
      branch: null,
      worktreePath: null,
      envMode: "local",
    });
    expect(store.getComposerDraft(sourceRef)).toBe(sourceComposer);
    expect(testState.shells).toEqual([source]);
    expect(testState.remember).toHaveBeenCalledTimes(1);
  });

  it("uses only the latest used target-project shell before any config has been remembered", async () => {
    const older = shell(TARGET, {
      id: ThreadId.make("older"),
      latestUserMessageAt: "2026-10-14T10:00:00.000Z",
    });
    const latest = shell(TARGET, {
      id: ThreadId.make("latest"),
      runtimeMode: "auto",
      composerMode: "deep-plan",
    });
    const other = shell(scopeProjectRef(ENVIRONMENT, OTHER_PROJECT), {
      id: ThreadId.make("other"),
      latestUserMessageAt: "2026-10-17T10:00:00.000Z",
      modelSelection: DEFAULT_SELECTION,
    });
    testState.shells.push(older, latest, other);
    testState.router.state.matches = [
      { params: { environmentId: ENVIRONMENT, threadId: other.id } },
    ];

    const opened = await useNewThreadHandler()(TARGET);

    expect(useComposerDraftStore.getState().getComposerDraft(opened!.draftId)).toMatchObject({
      activeProvider: REMEMBERED_SELECTION.instanceId,
      runtimeMode: "auto",
      composerMode: "deep-plan",
    });
    expect(testState.remember).not.toHaveBeenCalled();
  });

  it("does not carry the current project or environment's remembered settings into another project", async () => {
    testState.remembered.set(testState.key(TARGET), REMEMBERED_SETTINGS);
    testState.remembered.set(
      testState.key(scopeProjectRef(REMOTE_ENVIRONMENT, OTHER_PROJECT)),
      REMEMBERED_SETTINGS,
    );
    const viewed = shell(TARGET);
    testState.shells.push(viewed, shell(scopeProjectRef(REMOTE_ENVIRONMENT, OTHER_PROJECT)));
    testState.router.state.matches = [
      { params: { environmentId: ENVIRONMENT, threadId: viewed.id } },
    ];
    useComposerDraftStore.getState().setStickyModelSelection(REMEMBERED_SELECTION);

    const opened = await useNewThreadHandler()(scopeProjectRef(ENVIRONMENT, OTHER_PROJECT));

    expect(useComposerDraftStore.getState().getComposerDraft(opened!.draftId)).toMatchObject({
      activeProvider: DEFAULT_SELECTION.instanceId,
      modelSelectionByProvider: { [DEFAULT_SELECTION.instanceId]: DEFAULT_SELECTION },
      runtimeMode: "approval-required",
      composerMode: "default",
    });
  });

  it("uses defaults for an existing empty settings record instead of bootstrapping an older shell", async () => {
    testState.remembered.set(testState.key(TARGET), {});
    testState.shells.push(shell(TARGET));

    const opened = await useNewThreadHandler()(TARGET);

    expect(useComposerDraftStore.getState().getComposerDraft(opened!.draftId)).toMatchObject({
      activeProvider: DEFAULT_SELECTION.instanceId,
      runtimeMode: "approval-required",
      composerMode: "default",
    });
  });

  it.each(["plan", "deep-plan"] as const)(
    "keeps preferred %s mode while controls and send use default when it is unavailable",
    async (composerMode) => {
      testState.remembered.set(testState.key(TARGET), { ...REMEMBERED_SETTINGS, composerMode });
      const config = testState.configs.get(ENVIRONMENT)!;
      testState.configs.set(ENVIRONMENT, {
        ...config,
        providers: config.providers.map((entry) => ({
          ...entry,
          showInteractionModeToggle: false,
          deepPlanning: undefined,
        })),
      });

      const opened = await useNewThreadHandler()(TARGET);
      const draft = useComposerDraftStore.getState().getComposerDraft(opened!.draftId);
      const effectiveMode = resolveAvailableComposerMode({
        mode: draft!.composerMode!,
        interactionModeEnabled: false,
        deepPlanningSupported: false,
      });
      const rememberedOnSend = readComposerProjectChatSettings({
        draft,
        fallback: {
          modelSelection: DEFAULT_SELECTION,
          runtimeMode: "approval-required",
          composerMode: effectiveMode,
        },
      });

      expect(effectiveMode).toBe("default");
      expect(rememberedOnSend.composerMode).toBe(composerMode);
      expect(testState.remember).not.toHaveBeenCalled();
    },
  );

  it("refreshes hidden unused drafts with a complete snapshot and removes stale options", async () => {
    const store = useComposerDraftStore.getState();
    const draftId = DraftId.make("hidden-draft");
    store.setLogicalProjectDraftThreadId(scopedProjectKey(TARGET), TARGET, draftId);
    store.setModelSelection(draftId, REMEMBERED_SELECTION, { explicit: true });
    store.setComposerMode(draftId, "deep-plan");
    testState.remembered.set(testState.key(TARGET), {
      modelSelection: {
        instanceId: REMEMBERED_SELECTION.instanceId,
        model: REMEMBERED_SELECTION.model,
      },
      runtimeMode: "full-access",
      composerMode: "plan",
    });

    const opened = await useNewThreadHandler()(TARGET);

    expect(opened?.draftId).toBe(draftId);
    expect(store.getComposerDraft(draftId)).toMatchObject({
      runtimeMode: "full-access",
      composerMode: "plan",
    });
    expect(
      store.getComposerDraft(draftId)?.modelSelectionByProvider[REMEMBERED_SELECTION.instanceId]
        ?.options,
    ).toBeUndefined();
  });

  it("resolves the physical target project's settings when logical grouping reuses the open draft", async () => {
    testState.logicalProjectKey = "shared-project";
    const store = useComposerDraftStore.getState();
    const draftId = DraftId.make("grouped-draft");
    store.setLogicalProjectDraftThreadId("shared-project", TARGET, draftId);
    store.setModelSelection(draftId, REMEMBERED_SELECTION, { explicit: true });
    store.setRuntimeMode(draftId, "full-access");
    store.setComposerMode(draftId, "deep-plan");
    testState.router.state.location.href = `/draft/${draftId}`;
    testState.router.state.matches = [{ params: { draftId } }];
    const target = scopeProjectRef(ENVIRONMENT, OTHER_PROJECT);

    const opened = await useNewThreadHandler()(target);

    expect(opened?.draftId).toBe(draftId);
    expect(store.getDraftSession(draftId)?.projectId).toBe(OTHER_PROJECT);
    expect(store.getComposerDraft(draftId)).toMatchObject({
      activeProvider: DEFAULT_SELECTION.instanceId,
      runtimeMode: "approval-required",
      composerMode: "default",
    });
    expect(store.getComposerDraft(draftId)?.modelSelectionByProvider).toEqual({
      [DEFAULT_SELECTION.instanceId]: DEFAULT_SELECTION,
    });
  });

  it("does not reset a hidden draft that gains content during the project-file read", async () => {
    let completeRead: (value: null) => void = () => undefined;
    testState.projectFileRead = new Promise<null>((resolve) => {
      completeRead = resolve;
    });
    const config = testState.configs.get(ENVIRONMENT)!;
    testState.configs.set(ENVIRONMENT, {
      ...config,
      settings: { ...config.settings, defaultThreadEnvMode: null },
    });
    const store = useComposerDraftStore.getState();
    const draftId = DraftId.make("delayed-draft");
    store.setLogicalProjectDraftThreadId(scopedProjectKey(TARGET), TARGET, draftId);
    const pending = useNewThreadHandler()(TARGET);
    store.setPrompt(draftId, "Written while settings were loading");
    completeRead(null);

    expect(await pending).toBeNull();
    expect(store.getComposerDraft(draftId)?.prompt).toBe("Written while settings were loading");
    expect(testState.router.navigate).not.toHaveBeenCalled();
  });

  it("preserves a human model pick in the same draft and keeps invested drafts separate", async () => {
    const store = useComposerDraftStore.getState();
    const draftId = DraftId.make("human-draft");
    store.setLogicalProjectDraftThreadId(scopedProjectKey(TARGET), TARGET, draftId);
    store.setModelSelection(draftId, DEFAULT_SELECTION, { explicit: true });
    testState.router.state.location.href = `/draft/${draftId}`;
    testState.router.state.matches = [{ params: { draftId } }];
    testState.remembered.set(testState.key(TARGET), REMEMBERED_SETTINGS);

    const reused = await useNewThreadHandler()(TARGET);
    expect(reused?.draftId).toBe(draftId);
    expect(
      store.getComposerDraft(draftId)?.modelSelectionByProvider[DEFAULT_SELECTION.instanceId],
    ).toEqual(DEFAULT_SELECTION);
    store.setPrompt(draftId, "Work in progress");
    const invested = store.getComposerDraft(draftId);

    const fresh = await useNewThreadHandler()(TARGET);

    expect(fresh?.draftId).not.toBe(draftId);
    expect(store.getComposerDraft(draftId)).toBe(invested);
    expect(store.getComposerDraft(fresh!.draftId)?.prompt).toBe("");
    expect(store.getComposerDraft(fresh!.draftId)?.activeProvider).toBe(
      REMEMBERED_SELECTION.instanceId,
    );
  });
});
