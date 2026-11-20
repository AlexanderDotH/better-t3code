import {
  CommandId,
  DEEP_PLAN_MAX_CHATS,
  DeepPlanRunId,
  deriveDeepPlanImplementationThreadId,
  EnvironmentId,
  ExecutionEnvironmentCapabilities,
  PlanId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ComposerMode,
  type DeepPlanLegacyRun,
  type DeepPlanReview,
  type DeepPlanRun,
  type DeepPlanSourceRef,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import {
  cloneElement,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Preferences } from "../../persistence/mobile-preferences";

const fixture = vi.hoisted(() => ({
  preferences: {} as Preferences,
  states: [] as unknown[],
  cursor: 0,
  platform: "ios",
  shortcut: null as (() => unknown) | null,
  effects: null as Array<() => void> | null,
  dispatch: vi.fn(),
  enqueue: vi.fn(),
  updateDraft: vi.fn(),
  navigate: vi.fn(),
  confirm: vi.fn(),
  shells: [] as unknown[],
  environments: [] as unknown[],
  archives: [] as unknown[],
  links: new Map(),
}));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: {},
  updateMobilePreferencesAtom: {},
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => AsyncResult.success(fixture.preferences),
  useAtomSet: () => (update: { transform: (current: Preferences) => Partial<Preferences> }) => {
    fixture.preferences = { ...fixture.preferences, ...update.transform(fixture.preferences) };
  },
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => {
    fixture.effects?.push(effect);
  },
  useMemo: (create: () => unknown) => create(),
  useRef: (initial: unknown) => {
    const index = fixture.cursor++;
    if (!(index in fixture.states)) fixture.states[index] = { current: initial };
    return fixture.states[index];
  },
  useState: (initial: unknown) => {
    const index = fixture.cursor++;
    if (!(index in fixture.states))
      fixture.states[index] = typeof initial === "function" ? initial() : initial;
    return [
      fixture.states[index],
      (next: unknown) => {
        fixture.states[index] = typeof next === "function" ? next(fixture.states[index]) : next;
      },
    ];
  },
}));
vi.mock("react-native", () => ({
  Modal: "modal",
  View: "view",
  Pressable: "pressable",
  ScrollView: "scroll-view",
  TextInput: "input",
  Platform: {
    get OS() {
      return fixture.platform;
    },
  },
  useWindowDimensions: () => ({ height: 800, width: 390 }),
  FlatList: (props: {
    data: ReadonlyArray<unknown>;
    renderItem: (info: { item: unknown }) => ReactNode;
  }) =>
    createElement(
      "list",
      {},
      props.data.map((item) => props.renderItem({ item })),
    ),
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ dispatch: vi.fn() }) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34 }),
}));
vi.mock("../../components/ui/AppText", () => ({ AppText: "text" }));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: "symbol" }));
vi.mock("../../components/ui/ThemedSwitch", () => ({ ThemedSwitch: "switch" }));
vi.mock("../../components/ui/Button", () => ({
  Button: (props: { label: string; onPress: () => void; disabled: boolean }) =>
    createElement("pressable", { onPress: props.onPress, disabled: props.disabled }, props.label),
}));
vi.mock("../../components/ui/Dialog", () => ({ confirm: fixture.confirm, alert: vi.fn() }));
vi.mock("./ThreadDetailSheet", () => ({
  ThreadDetailSheet: (props: { children: ReactNode }) => createElement("sheet", {}, props.children),
}));
vi.mock("../../components/ComposerToolbar", () => ({
  ComposerInlineControl: (props: { label: string; onPress: () => void; disabled: boolean }) =>
    createElement("pressable", { onPress: props.onPress, disabled: props.disabled }, props.label),
}));
vi.mock("../keyboard/hardwareKeyboardCommands", () => ({
  useHardwareKeyboardCommand: (_command: string, callback: () => unknown) => {
    fixture.shortcut = callback;
  },
}));
vi.mock("../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () =>
    createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => [],
  useThreadShells: () => fixture.shells,
  useThreadShell: () => ({ id: ownerThreadId, projectId, modelSelection, runtime: null }),
  useEnvironmentServerConfig: () => ({
    environment: { capabilities: { deepPlanning: { version: 2 } } },
    providers: [],
    settings: { parallelPlanReviewModelSelection: null },
  }),
}));
vi.mock("../../state/workspace", () => ({ useWorkspaceEnvironments: () => fixture.environments }));
vi.mock("../../state/peerLinks", () => ({ useLinkedEnvironments: () => fixture.links }));
vi.mock("../archive/useArchivedThreadSnapshots", () => ({
  useArchivedThreadSnapshots: () => ({ snapshots: fixture.archives }),
}));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => fixture.dispatch }));
vi.mock("../../state/orchestration", () => ({
  orchestrationEnvironment: { v2: { dispatchCommand: { permissionAtom: () => ({}) } } },
}));
vi.mock("../../state/projects", () => ({
  projectEnvironment: { writeFile: { permissionAtom: () => ({}) } },
}));
vi.mock("../../state/use-thread-detail", () => ({ useSelectedThreadProjection: () => null }));
vi.mock("../../state/thread-outbox", () => ({ enqueueThreadOutboxMessage: fixture.enqueue }));
vi.mock("../../state/use-composer-drafts", () => ({
  useComposerDraftSettings: () => ({}),
  updateComposerDraftSettings: fixture.updateDraft,
}));
vi.mock("../../state/composer-library", () => ({}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "test-id" }));
vi.mock("./use-plan-parallelism-review", () => ({
  useMobilePlanParallelismReview: () => ({ status: "idle", reviewedSubagentCount: null }),
}));
vi.mock("./CopyTextButton", () => ({ CopyTextButton: () => null }));
vi.mock("./ThreadForkButton", () => ({ ThreadForkButton: () => null }));
vi.mock("./use-thread-fork-action", () => ({ useThreadForkAction: () => null }));
vi.mock("./useOpenLinkedThread", () => ({ useOpenLinkedThread: () => fixture.navigate }));
vi.mock("./share-plan-markdown", () => ({}));

import { ComposerModeControl } from "./ComposerModeControl";
import { DeepPlanChecklist } from "./DeepPlanChecklist";
import { DeepPlanSources, DeepPlanSourceSheet } from "./DeepPlanSources";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { composerModeAvailability, nextAvailableComposerMode } from "./composer-mode-availability";

type NativeProps = {
  children?: ReactNode;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: { checked?: boolean; expanded?: boolean; disabled?: boolean };
  onPress?: () => void;
  onChangeText?: (text: string) => void;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
};
function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement<NativeProps>(node)) return node;
  if (typeof node.type === "function")
    return expand((node.type as (props: NativeProps) => ReactNode)(node.props));
  return cloneElement(node, {}, expand(node.props.children));
}
function hosts(node: ReactNode, type: string): ReactElement<NativeProps>[] {
  if (Array.isArray(node)) return node.flatMap((child) => hosts(child, type));
  if (!isValidElement<NativeProps>(node)) return [];
  return [...(node.type === type ? [node] : []), ...hosts(node.props.children, type)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement<NativeProps>(node) ? text(node.props.children) : "";
}
function press(node: ReactNode, label: string) {
  const control = hosts(node, "pressable").find(
    (item) => item.props.accessibilityLabel === label || text(item).includes(label),
  );
  if (!control?.props.onPress || control.props.disabled)
    throw new Error(`Expected enabled control: ${label}`);
  return control.props.onPress();
}
function render(component: () => ReactNode) {
  fixture.cursor = 0;
  return expand(component());
}

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("current-project");
const now = "2026-10-16T12:00:00.000Z";
const ownerThreadId = ThreadId.make("owner-chat");
const reviewThreadId = ThreadId.make("review-chat");
const remoteEnvironmentId = EnvironmentId.make("linked");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "model" };
const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);
const review: DeepPlanReview = {
  round: 1,
  reviewThreadId,
  reviewer: modelSelection,
  diff: null,
  verdict: "changesRequested",
  summary: "Handle the reconnect path before proceeding.",
  findings: [
    {
      severity: "major",
      title: "Restore selected chats on reconnect",
      detail: "The saved IDs were rewritten on reconnect.",
      file: "src/store.ts",
      line: 18,
      rule: "Preserve persisted data.",
    },
  ],
  retries: 0,
  startedAt: now,
  completedAt: now,
};

function source(index: number, remote = false) {
  return {
    origin: {
      environmentId: remote ? remoteEnvironmentId : environmentId,
      projectId,
      threadId: ThreadId.make(`chat-${index}`),
    },
    threadTitle: `Chat ${index}`,
    projectTitle: remote ? "Linked project" : "T3 Code",
    archived: remote,
  };
}

function runFixture(overrides?: Partial<DeepPlanRun>): DeepPlanRun {
  return {
    schemaVersion: 2,
    id: DeepPlanRunId.make("deep-run"),
    threadId: ownerThreadId,
    phase: "implementing",
    revision: 3,
    approvalKey: "approval-key",
    approval: {
      planVersion: 1,
      approvalKey: "approval-key",
      approvedAt: now,
      implementation: modelSelection,
      reviewer: modelSelection,
      parallelism: 1,
      lanes: [{ laneId: "lane-1", threadId: ownerThreadId }],
      baseTurnCount: 0,
    },
    plan: {
      schemaVersion: 2,
      version: 1,
      goal: "Add Deep Planning",
      scope: ["Native app"],
      nonGoals: [],
      affectedAreas: ["Composer"],
      decisions: [],
      steps: [
        {
          id: "picker",
          title: "Choose chats",
          description: "Build the chat picker",
          dependencies: [],
          acceptanceCriteria: [
            {
              id: "selection",
              description: "Selections survive reconnect",
              checkMethod: "Reconnect and reopen the picker",
            },
          ],
        },
        {
          id: "run",
          title: "Show progress",
          description: "Render durable progress",
          dependencies: ["picker"],
          acceptanceCriteria: [
            { id: "progress", description: "Show progress", checkMethod: "Check the snapshot" },
          ],
        },
      ],
      finalValidation: {
        description: "Validate the complete native flow",
        checkMethod: "Run focused native interaction tests",
      },
    },
    chats: [],
    includeProjectChats: false,
    steps: [
      {
        stepId: "picker",
        status: "changesRequested",
        laneId: "lane-1",
        baseTurnCount: 0,
        submission: null,
        reviews: [review],
        roundLimit: 3,
        unsubmittedTurns: 0,
      },
    ],
    finalReview: {
      status: "pending",
      submission: null,
      reviews: [],
      roundLimit: 3,
      unsubmittedTurns: 0,
    },
    activeTurns: [
      {
        kind: "fix",
        threadId: ownerThreadId,
        commandId: CommandId.make("fix-turn"),
        stepId: "picker",
        laneId: "lane-1",
        round: 1,
        attempt: 1,
        startedAt: now,
      },
    ],
    pause: null,
    operations: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  fixture.preferences = {};
  fixture.states = [];
  fixture.cursor = 0;
  fixture.platform = "ios";
  fixture.shortcut = null;
  fixture.effects = null;
  fixture.dispatch.mockReset();
  fixture.enqueue.mockReset();
  fixture.updateDraft.mockReset();
  fixture.navigate.mockReset();
  fixture.confirm.mockReset();
  fixture.shells = [];
  fixture.environments = [];
  fixture.archives = [];
  fixture.links = new Map();
});

describe("native Deep Planning", () => {
  it.each(["ios", "android"])("selects modes directly and cycles by keyboard on %s", (platform) => {
    fixture.platform = platform;
    let mode: ComposerMode = "default";
    const modeControl = () =>
      render(() =>
        ComposerModeControl({
          mode,
          onChange: (next) => {
            mode = next;
          },
        }),
      );
    press(modeControl(), "Build");
    press(modeControl(), "Plan");
    expect(mode).toBe("plan");
    modeControl();
    fixture.shortcut?.();
    expect(mode).toBe("deep-plan");
    press(modeControl(), "Deep Plan");
    press(modeControl(), "Chat");
    expect(mode).toBe("chat");
    press(modeControl(), "Chat");
    press(modeControl(), "Build");
    expect(mode).toBe("default");
  });

  it("only enables Deep Plan with a v2 environment and a supported provider", () => {
    const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
    const unavailable = composerModeAvailability(
      { provider: null, capabilities: null, planningEnabled: false },
      translator,
    );
    expect(unavailable.default).toBeNull();
    expect(unavailable.chat).toBeNull();
    expect(unavailable.plan).toBeTruthy();
    expect(unavailable["deep-plan"]).toBeTruthy();
    expect(nextAvailableComposerMode("default", unavailable)).toBe("chat");
    const provider = {
      instanceId: modelSelection.instanceId,
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      enabled: true,
      installed: true,
      version: "1",
      status: "ready" as const,
      availability: "available" as const,
      auth: { status: "authenticated" as const },
      checkedAt: now,
      models: [],
      slashCommands: [],
      skills: [],
      deepPlanning: { version: 1 as const, structuredPlans: true, durableExecution: true },
    };
    const capabilities = { repositoryIdentity: false, midChatProviderSwitching: false };
    expect(
      composerModeAvailability(
        {
          provider,
          capabilities: decodeCapabilities({
            ...capabilities,
            deepPlanning: { version: 1, sourceExport: true, sourceImport: true },
          }),
        },
        translator,
      )["deep-plan"],
    ).toBeTruthy();
    const supported = {
      provider,
      capabilities: { ...capabilities, deepPlanning: { version: 2 as const } },
    };
    expect(composerModeAvailability(supported, translator)["deep-plan"]).toBeNull();
    expect(
      composerModeAvailability({ ...supported, connected: false }, translator)["deep-plan"],
    ).toBeTruthy();
    expect(
      composerModeAvailability({ ...supported, multipleModels: true }, translator)["deep-plan"],
    ).toBeTruthy();
  });

  it("dispatches only explicit Deep Plan controls", async () => {
    const changes: string[] = [];
    let run = runFixture();
    const checklist = () =>
      render(() =>
        DeepPlanChecklist({
          environmentId,
          run,
          onControl: async (action) => {
            changes.push(action);
          },
        }),
      );
    fixture.effects = [];
    const initial = checklist();
    for (const effect of fixture.effects) effect();
    fixture.effects = null;
    expect(text(initial)).toContain("Addressing findings for step 1");
    expect(changes).toEqual([]);
    await press(checklist(), "Pause");
    expect(changes).toEqual(["pause"]);
    run = {
      ...run,
      phase: "paused",
      pause: { kind: "user", reason: "Paused by the user.", at: now },
    };
    expect(text(checklist())).toContain("Paused by you");
    await press(checklist(), "Resume");
    expect(changes).toEqual(["pause", "resume"]);
    press(checklist(), "Cancel");
    expect(changes).toEqual(["pause", "resume"]);
    fixture.confirm.mock.lastCall?.[0].onConfirm();
    expect(changes).toEqual(["pause", "resume", "cancel"]);
  });

  it("shows the review verdict, findings, and direct link to the hidden review thread", () => {
    const open = vi.fn();
    const run = runFixture();
    const checklist = () =>
      render(() => DeepPlanChecklist({ environmentId, run, onOpenThread: open }));
    expect(text(checklist())).toContain("Lane 1");
    expect(text(checklist())).toContain("Round 1/3");
    expect(text(checklist())).toContain("Changes requested");
    press(checklist(), "Choose chats");
    expect(text(checklist())).toContain("Selections survive reconnect");
    expect(text(checklist())).toContain("Restore selected chats on reconnect");
    expect(text(checklist())).toContain("src/store.ts:18");
    press(checklist(), "Open review");
    expect(open).toHaveBeenCalledWith(reviewThreadId);
  });

  it("suggests a fresh Deep Plan only for unfinished legacy runs that can start one", () => {
    const run: DeepPlanLegacyRun = {
      schemaVersion: 1,
      kind: "legacy",
      id: DeepPlanRunId.make("legacy"),
      threadId: ownerThreadId,
      goal: "Earlier plan",
      finished: false,
      updatedAt: now,
    };
    const checklist = (value: DeepPlanLegacyRun, deepPlanSupported: boolean) =>
      render(() =>
        DeepPlanChecklist({ environmentId, run: value, deepPlanSupported, onControl: vi.fn() }),
      );
    const unfinished = checklist(run, true);
    expect(text(unfinished)).toContain("Earlier plan");
    expect(text(unfinished)).toContain("started in an earlier version");
    expect(hosts(unfinished, "pressable")).toHaveLength(0);
    expect(checklist({ ...run, finished: true }, true)).toBeNull();
    expect(checklist(run, false)).toBeNull();
  });

  it.each(["current", "new"] as const)(
    "approves the plan's parallel lanes in one dispatch for a %s thread",
    async (target) => {
      const pending = runFixture({
        phase: "awaitingApproval",
        approval: null,
        steps: [],
        activeTurns: [],
      });
      const plan = pending.plan!;
      const run: DeepPlanRun = {
        ...pending,
        plan: { ...plan, steps: plan.steps.map((step) => ({ ...step, dependencies: [] })) },
      };
      const completed = Promise.withResolvers<void>();
      fixture.dispatch.mockResolvedValue(AsyncResult.success({ sequence: 4 }));
      const card = () =>
        render(() =>
          ProposedPlanCard({
            environmentId,
            workspaceRoot: "/project",
            markdown: "# Add Deep Planning",
            deepPlan: run,
            plan: {
              threadId: ownerThreadId,
              planId: PlanId.make("proposal"),
              updatedAt: DateTime.makeUnsafe(now),
              deepPlan: { runId: run.id, planVersion: 1 },
            },
            onActionComplete: () => completed.resolve(),
            renderMarkdown: (markdown) => markdown,
          }),
        );
      const label =
        target === "new" ? "Implement with 2 lanes in a new thread" : "Implement with 2 lanes";
      const ready = card();
      press(ready, label);
      press(ready, label);
      await completed.promise;
      expect(fixture.dispatch).toHaveBeenCalledTimes(1);
      expect(fixture.dispatch).toHaveBeenCalledWith({
        environmentId,
        input: expect.objectContaining({
          type: "thread.deep-plan.update",
          threadId: ownerThreadId,
          runId: run.id,
          expectedRevision: run.revision,
          mutation: {
            type: "approve",
            planVersion: 1,
            approvalKey: "approval-key",
            implementation: modelSelection,
            implementationThread: target,
            parallelism: 2,
          },
        }),
      });
      expect(fixture.updateDraft).toHaveBeenCalledWith(`${environmentId}:${ownerThreadId}`, {
        composerMode: "default",
        interactionMode: "default",
      });
      expect(fixture.enqueue).not.toHaveBeenCalled();
      if (target === "new") {
        expect(fixture.navigate).toHaveBeenCalledWith({
          environmentId,
          threadId: deriveDeepPlanImplementationThreadId(run.id, 1),
        });
      } else {
        expect(fixture.navigate).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["ios", "android"])(
    "keeps project chats opt-in when selecting chats on %s",
    (platform) => {
      fixture.platform = platform;
      const additional = source(1, true);
      let selected: ReadonlyArray<DeepPlanSourceRef> = [];
      let includeProjectChats = false;
      const sheet = () =>
        render(() =>
          DeepPlanSourceSheet({
            environmentId,
            projectId,
            sources: [source(0), additional],
            selected,
            includeProjectChats,
            onChange: (next, include) => {
              selected = next;
              includeProjectChats = include;
            },
            onClose: vi.fn(),
          }),
        );
      press(sheet(), "Chat 0");
      expect(selected).toEqual([source(0).origin]);
      hosts(sheet(), "switch")[0]?.props.onValueChange?.(true);
      const included = sheet();
      expect(includeProjectChats).toBe(true);
      expect(selected).toEqual([]);
      const base = hosts(included, "pressable").find(
        (item) => item.props.accessibilityRole === "checkbox" && item.props.disabled,
      );
      expect(base?.props.accessibilityState?.checked).toBe(true);
      hosts(sheet(), "input")[0]?.props.onChangeText?.("Linked project");
      const filtered = sheet();
      expect(text(filtered)).not.toContain("Chat 0");
      press(filtered, "Chat 1");
      expect(selected).toEqual([additional.origin]);
    },
  );

  it("lists linked archived and local chats without exposing hidden or unlinked threads", () => {
    const unlinked = EnvironmentId.make("unlinked");
    fixture.environments = [environmentId, remoteEnvironmentId, unlinked].map((id) => ({
      environmentId: id,
      environmentLabel: id,
      connectionState: "connected",
    }));
    fixture.links.set(remoteEnvironmentId, "Linked");
    const thread = (id: ThreadId, title: string, env: EnvironmentId) => ({
      id,
      title,
      projectId,
      environmentId: env,
      archivedAt: null,
      deletedAt: null,
      lineage: { parentThreadId: null, relationshipToParent: null },
    });
    fixture.shells = [
      thread(ownerThreadId, "Owner chat", environmentId),
      thread(ThreadId.make("local"), "Local chat", environmentId),
      thread(ThreadId.make("unlinked"), "Unlinked chat", unlinked),
      {
        ...thread(reviewThreadId, "Hidden review", environmentId),
        lineage: { parentThreadId: ownerThreadId, relationshipToParent: "subagent" },
      },
    ];
    fixture.archives = [
      {
        environmentId: remoteEnvironmentId,
        snapshot: {
          projects: [{ id: projectId, title: "Linked project" }],
          threads: [
            {
              ...thread(ThreadId.make("archived"), "Archived linked chat", remoteEnvironmentId),
              archivedAt: now,
            },
          ],
        },
      },
    ];
    const picker = () =>
      render(() =>
        DeepPlanSources({
          environmentId,
          projectId,
          threadId: ownerThreadId,
          selected: [],
          includeProjectChats: false,
          onChange: vi.fn(),
        }),
      );
    press(picker(), "Add chats");
    const list = text(picker());
    expect(list).toContain("Local chat");
    expect(list).toContain("Archived linked chat");
    expect(list).not.toContain("Owner chat");
    expect(list).not.toContain("Unlinked chat");
    expect(list).not.toContain("Hidden review");
  });

  it("keeps chosen chats removable at the selection limit", () => {
    const sources = Array.from({ length: DEEP_PLAN_MAX_CHATS + 1 }, (_, index) => source(index));
    const sheet = render(() =>
      DeepPlanSourceSheet({
        environmentId,
        projectId,
        sources,
        selected: sources.slice(0, DEEP_PLAN_MAX_CHATS).map((item) => item.origin),
        includeProjectChats: false,
        onChange: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    const chats = hosts(sheet, "pressable").filter(
      (item) => item.props.accessibilityRole === "checkbox",
    );
    expect(chats[0]?.props.disabled).toBe(false);
    expect(chats.at(-1)?.props.disabled).toBe(true);
  });
});
