import {
  DeepPlanRunId,
  DeepPlanSourceId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ComposerMode,
  type DeepPlanRun,
  type DeepPlanSourceCatalogEntry,
  type DeepPlanSourceRef,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import {
  cloneElement,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  platform: "ios",
  shortcut: null as (() => unknown) | null,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  memo: (component: unknown) => component,
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
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
  ActivityIndicator: "progress",
  Platform: {
    get OS() {
      return fixture.platform;
    },
  },
  useWindowDimensions: () => ({ height: 800, width: 390 }),
  FlatList: (props: {
    data: ReadonlyArray<DeepPlanSourceCatalogEntry>;
    renderItem: (info: { item: DeepPlanSourceCatalogEntry }) => ReactNode;
  }) =>
    createElement(
      "list",
      {},
      props.data.map((item) => props.renderItem({ item })),
    ),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34 }),
}));
vi.mock("../../components/AppText", () => ({ AppText: "text" }));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: "symbol" }));
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
  useServerConfigs: () => new Map(),
}));
vi.mock("../../state/workspace", () => ({ useWorkspaceState: () => ({ environments: [] }) }));
vi.mock("../../state/deep-planning", () => ({ getMobileDeepPlanningApi: vi.fn() }));

import { ComposerModeControl } from "./ComposerModeControl";
import { DeepPlanChecklist } from "./DeepPlanChecklist";
import { DeepPlanSourceSheet } from "./DeepPlanSources";

type NativeProps = {
  children?: ReactNode;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: { checked?: boolean; expanded?: boolean; disabled?: boolean };
  onPress?: () => void;
  onChangeText?: (text: string) => void;
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
function source(
  index: number,
  overrides: Partial<DeepPlanSourceCatalogEntry> = {},
): DeepPlanSourceCatalogEntry {
  return {
    origin: { environmentId, projectId, threadId: ThreadId.make(`chat-${index}`) },
    threadTitle: `Chat ${index}`,
    projectTitle: "T3 Code",
    archived: index % 2 === 0,
    messageCount: 1,
    activityCount: 0,
    forkOrigin: null,
    ...overrides,
  };
}
function runFixture(): DeepPlanRun {
  const sources = Array.from({ length: 28 }, (_, index) => ({
    ...source(index),
    sourceId: DeepPlanSourceId.make(`source-${index}`),
    capturedAt: now,
    contentVersion: "1",
    contentHash: `hash-${index}`,
    attachmentCount: 0,
    recordCount: 1,
  }));
  return {
    id: DeepPlanRunId.make("deep-run"),
    threadId: ThreadId.make("owner-chat"),
    phase: "implementing",
    revision: 3,
    approvalKey: "approval-key",
    approval: {
      planVersion: 1,
      approvalKey: "approval-key",
      approvedAt: now,
      approvedBy: "user",
      implementation: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
      implementationThreadId: ThreadId.make("owner-chat"),
      implementerId: "same-agent",
    },
    plan: {
      schemaVersion: 1,
      version: 1,
      goal: "Add Deep Planning",
      scope: ["Native app"],
      affectedAreas: ["Composer"],
      decisions: [],
      steps: [
        {
          id: "source-picker",
          title: "Choose sources",
          description: "Build the source picker",
          dependencies: [],
          acceptanceCriteria: [
            {
              id: "source-selection",
              description: "Selections survive reconnect",
              checkMethod: "Reconnect and reopen the picker",
            },
          ],
        },
        {
          id: "checklist",
          title: "Show checklist",
          description: "Render durable progress",
          dependencies: ["source-picker"],
          acceptanceCriteria: [
            {
              id: "durable-progress",
              description: "Show durable step evidence",
              checkMethod: "Read the latest snapshot",
            },
          ],
        },
      ],
      finalValidation: {
        description: "Validate the complete native flow",
        checkMethod: "Run focused native interaction tests",
      },
    },
    sources,
    sourceCoverage: sources.map((item, index) => ({
      sourceId: item.sourceId,
      status: index < 12 ? "summarized" : "pending",
      importedRecordCount: 1,
      readRecordCount: index < 12 ? 1 : 0,
      summary:
        index < 12
          ? {
              requirements: [],
              decisions: [],
              openIssues: [],
              conflicts: [],
              rejectedApproaches: [],
              citedRecordIds: ["record"],
            }
          : null,
      error: null,
      updatedAt: now,
    })),
    stepStates: [{ stepId: "source-picker", status: "inProgress", evidence: [], updatedAt: now }],
    finalValidation: {
      status: "pending",
      evidence: [],
      updatedAt: null,
      attempt: 0,
      requestId: null,
      turnId: null,
    },
    procedureAdjustments: [],
    operations: [],
    createdAt: now,
    updatedAt: now,
    pauseReason: null,
  };
}

beforeEach(() => {
  fixture.states = [];
  fixture.cursor = 0;
  fixture.platform = "ios";
  fixture.shortcut = null;
});

describe("native Deep Planning", () => {
  it.each(["ios", "android"])(
    "cycles Build, Plan and Deep Plan by tap and keyboard on %s",
    (platform) => {
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
      expect(mode).toBe("plan");
      modeControl();
      fixture.shortcut?.();
      expect(mode).toBe("deep-plan");
      press(modeControl(), "Deep Plan");
      expect(mode).toBe("default");
    },
  );

  it.each(["ios", "android"])(
    "keeps project chats included and edits additional archived sources on %s",
    (platform) => {
      fixture.platform = platform;
      const additional = source(1, {
        origin: {
          environmentId: EnvironmentId.make("remote"),
          projectId: ProjectId.make("other-project"),
          threadId: ThreadId.make("chat-other"),
        },
        projectTitle: "Mobile project",
        threadTitle: "Archived design decisions",
        archived: true,
      });
      let selected: ReadonlyArray<DeepPlanSourceRef> = [];
      const sheet = () =>
        render(() =>
          DeepPlanSourceSheet({
            environmentId,
            projectId,
            sources: [source(0), additional],
            selected,
            loading: false,
            error: null,
            onChange: (next) => {
              selected = next;
            },
            onRetry: vi.fn(),
            onClose: vi.fn(),
          }),
        );
      const initial = sheet();
      const base = hosts(initial, "pressable").find(
        (item) => item.props.accessibilityRole === "checkbox" && item.props.disabled,
      );
      expect(base?.props.accessibilityState?.checked).toBe(true);
      press(initial, "Archived design decisions");
      expect(selected).toEqual([additional.origin]);
      const search = hosts(sheet(), "input")[0];
      search?.props.onChangeText?.("Mobile project");
      const filtered = sheet();
      expect(text(filtered)).not.toContain("Chat 0");
      expect(text(filtered)).toContain("Archived design decisions");
      press(filtered, "Archived design decisions");
      expect(selected).toEqual([]);
    },
  );

  it("expands step requirements and shows updated evidence without losing the open step", () => {
    let run = runFixture();
    const checklist = () => render(() => DeepPlanChecklist({ run }));
    expect(text(checklist())).toContain("12 of 28 sources analyzed");
    expect(text(checklist())).not.toContain("Selections survive reconnect");
    press(checklist(), "Choose sources");
    expect(text(checklist())).toContain("Selections survive reconnect");
    expect(text(checklist())).toContain("No evidence recorded");
    run = {
      ...run,
      stepStates: [
        {
          stepId: "source-picker",
          status: "verified",
          evidence: [{ kind: "test", summary: "Reconnect test passed", createdAt: now }],
          updatedAt: now,
        },
      ],
    };
    const updated = checklist();
    expect(text(updated)).toContain("Reconnect test passed");
    expect(text(updated)).toContain("1 of 2 verified");
    press(updated, "Collapse checklist");
    expect(text(checklist())).not.toContain("Choose sources");
    press(checklist(), "Expand checklist");
    expect(text(checklist())).toContain("Reconnect test passed");
  });

  it("shows partial read progress and keeps a fully read chat pending until its summary is saved", () => {
    const base = runFixture();
    const source = { ...base.sources[0]!, recordCount: 100 };
    let run: DeepPlanRun = {
      ...base,
      phase: "planning",
      plan: null,
      approval: null,
      sources: [source],
      sourceCoverage: [
        {
          ...base.sourceCoverage[0]!,
          status: "ready",
          summary: null,
          importedRecordCount: 100,
          readRecordCount: 37,
        },
      ],
    };
    const checklist = () => render(() => DeepPlanChecklist({ run }));
    expect(text(checklist())).toContain(source.threadTitle);
    expect(text(checklist())).toContain("Reading · 37%");
    expect(text(checklist())).toContain("0 of 1 sources analyzed");
    run = { ...run, sourceCoverage: [{ ...run.sourceCoverage[0]!, readRecordCount: 100 }] };
    expect(text(checklist())).toContain("Read · summary pending");
    expect(text(checklist())).toContain("0 of 1 sources analyzed");
    run = {
      ...run,
      sourceCoverage: [
        {
          ...run.sourceCoverage[0]!,
          status: "summarized",
          summary: base.sourceCoverage[0]!.summary,
        },
      ],
    };
    expect(text(checklist())).toContain("1 of 1 sources analyzed");
    expect(text(checklist())).not.toContain("Read · summary pending");
  });

  it("shows source failures and final validation evidence as separate progress", () => {
    const original = runFixture();
    const run: DeepPlanRun = {
      ...original,
      phase: "blocked",
      pauseReason: "Source collection failed",
      sourceCoverage: [
        {
          ...original.sourceCoverage[0]!,
          status: "unavailable",
          error: "Remote source disconnected",
        },
      ],
      finalValidation: {
        ...original.finalValidation,
        status: "failed",
        evidence: [
          { kind: "test", summary: "Final validation found a regression", createdAt: now },
        ],
      },
    };
    const result = render(() => DeepPlanChecklist({ run }));
    expect(text(result)).toContain("Source collection failed");
    expect(text(result)).toContain("Remote source disconnected");
    expect(text(result)).toContain("Final validation found a regression");
    expect(text(result)).toContain("0 of 2 verified");
  });

  it("keeps a blocked run visible when Resume fails and makes retry available", async () => {
    let run: DeepPlanRun = {
      ...runFixture(),
      phase: "blocked" as const,
      pauseReason: "Validation needs another check",
    };
    const resume = vi.fn(async () => {
      throw new Error("Reconnect to resume this run");
    });
    const checklist = () => render(() => DeepPlanChecklist({ run, onResume: resume }));
    await press(checklist(), "Resume");
    const failed = checklist();
    expect(text(failed)).toContain("Validation needs another check");
    expect(text(failed)).toContain("Reconnect to resume this run");
    expect(
      hosts(failed, "pressable").find((button) => text(button) === "Resume")?.props.disabled,
    ).toBe(false);
    run = { ...run, revision: run.revision + 1, phase: "implementing", pauseReason: null };
    expect(text(checklist())).not.toContain("Reconnect to resume this run");
  });
});

it("offers continuation after the provider stops and keeps it hidden during active work", async () => {
  const run = runFixture();
  const resume = vi.fn(async () => {});
  const idle = render(() => DeepPlanChecklist({ run, canContinue: true, onResume: resume }));
  await press(idle, "Resume");
  expect(resume).toHaveBeenCalledTimes(1);
  const busy = render(() => DeepPlanChecklist({ run, canContinue: false, onResume: resume }));
  expect(hosts(busy, "pressable").some((button) => text(button) === "Resume")).toBe(false);
});

it("shows named source references and dependencies in the embedded checklist", async () => {
  const initial = runFixture();
  const sourceId = initial.sources[0]!.sourceId;
  const run = {
    ...initial,
    plan: {
      ...initial.plan!,
      steps: initial.plan!.steps.map((step) => ({
        ...step,
        sources: [{ sourceId, recordIds: ["internal-message-reference"] }],
        acceptanceCriteria: step.acceptanceCriteria.map((criterion) => ({
          ...criterion,
          sources: [{ sourceId, recordIds: ["internal-message-reference"] }],
        })),
      })),
    },
  };
  const checklist = () => render(() => DeepPlanChecklist({ run, embedded: true }));
  await press(checklist(), "Show checklist");
  const result = checklist();
  expect(text(result)).toContain("Depends on");
  expect(text(result)).toContain("Choose sources");
  expect(text(result)).toContain("T3 Code / Chat 0");
  expect(text(result)).toContain("Show durable step evidence");
  expect(text(result)).toContain("Run focused native interaction tests");
  expect(text(result)).not.toContain("internal-message-reference");
  expect(text(result)).not.toContain(sourceId);
});
