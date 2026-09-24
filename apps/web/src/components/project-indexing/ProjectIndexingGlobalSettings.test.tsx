import type { ProjectIndexClientApi } from "@t3tools/client-runtime/project-indexing";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EMPTY_PROJECT_INDEX_COVERAGE,
  EMPTY_PROJECT_INDEX_USAGE,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProjectIndexModelSelection,
  type ProjectIndexStatusV1,
  type ProjectIndexStreamEvent,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { act, type ComponentProps, type ReactNode } from "react";
import * as Option from "effect/Option";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  api: null as ProjectIndexClientApi | null,
  defaultsVersion: 1,
  save: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => fixture.navigate,
}));
vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
  return { useInterfaceTranslator: () => translator };
});
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: () => fixture.settings!,
  usePrimarySettingsAvailable: () => true,
  PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE: "Unavailable",
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { updateSettings: Symbol("update-settings") },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => fixture.save }));
vi.mock("../../state/projectIndexing", () => ({ bindProjectIndexApi: () => fixture.api! }));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: (id: string) => id },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: { authenticated: true, scopes: ["orchestration:read", "orchestration:operate"] },
    error: null,
    isPending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ status: "live", error: Option.none() }),
}));
vi.mock("../../state/shell", () => ({ environmentShell: { stateValueAtom: (id: string) => id } }));
vi.mock("../../state/environments", () => ({
  useEnvironment: () => environment(),
  useEnvironments: () => ({ environments: [environment()] }),
  usePrimaryEnvironmentId: () => environmentId,
}));
vi.mock("../../state/entities", () => ({ useProjects: () => projects, useThreadShells: () => [] }));
vi.mock("../ui/button", () => ({
  Button: ({
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & { size?: string; variant?: string }) => <button {...props} />,
}));
vi.mock("../ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled: boolean;
    "aria-label": string;
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}));
vi.mock("../ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled: boolean;
    "aria-label": string;
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}));
vi.mock("../ui/alert-dialog", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    AlertDialogClose: Container,
    AlertDialogDescription: Container,
    AlertDialogFooter: Container,
    AlertDialogHeader: Container,
    AlertDialogPopup: Container,
    AlertDialogTitle: Container,
  };
});
vi.mock("../ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string | null;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select value={value ?? ""} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectPopup: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("./ProjectIndexModelPicker", () => ({
  ProjectIndexModelPicker: ({
    selection,
    providers,
    disabled,
    onChange,
    label = "AI review model",
  }: {
    selection: ProjectIndexModelSelection | null;
    providers: ReadonlyArray<ServerProvider>;
    disabled: boolean;
    onChange: (selection: ProjectIndexModelSelection) => void;
    label?: string;
  }) => (
    <select
      aria-label={label}
      disabled={disabled}
      value={selection?.model ?? ""}
      onChange={(event) => {
        const provider = providers.find((candidate) =>
          candidate.models.some((model) => model.slug === event.currentTarget.value),
        );
        if (provider)
          onChange({ instanceId: provider.instanceId, model: event.currentTarget.value });
      }}
    >
      {providers.flatMap((provider) =>
        provider.models.map((model) => (
          <option key={`${provider.instanceId}:${model.slug}`} value={model.slug}>
            {model.name}
          </option>
        )),
      )}
    </select>
  ),
}));
vi.mock("./ProjectIndexEntityBrowser", () => ({ ProjectIndexEntityBrowser: () => null }));
vi.mock("./ProjectIndexSourceDialog", () => ({ ProjectIndexSourceDialog: () => null }));

import { ProjectIndexingGlobalSettings } from "./ProjectIndexingGlobalSettings";
import { ProjectIndexingSettingsController } from "./ProjectIndexingSettingsController";

const environmentId = EnvironmentId.make("environment");
const firstProject = ProjectId.make("project-a");
const secondProject = ProjectId.make("project-b");
const instanceId = ProviderInstanceId.make("codex");
const model = (name: string) => ({ instanceId, model: name });
const providers: ReadonlyArray<ServerProvider> = [
  {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-21T00:00:00.000Z",
    models: ["model-a", "model-b", "model-c"].map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: null,
    })),
    slashCommands: [],
    skills: [],
  },
];
const projects = [firstProject, secondProject].map((id) => ({
  id,
  environmentId,
  title: id,
  workspaceRoot: `/workspace/${id}`,
}));
const statuses = new Map<ProjectId, ProjectIndexStatusV1>();
const listeners = new Map<ProjectId, Set<(event: ProjectIndexStreamEvent) => void>>();

function environment() {
  return {
    environmentId,
    label: "Environment",
    connection: { phase: "connected" },
    entry: { target: { _tag: "RemoteConnectionTarget" } },
    serverConfig: {
      environment: {
        capabilities: {
          projectIndexingVersion: 3,
          ...(fixture.defaultsVersion
            ? { projectIndexingDefaultsVersion: fixture.defaultsVersion }
            : {}),
        },
      },
      settings: fixture.settings!,
      providers,
    },
  };
}

function statusFor(projectId: ProjectId) {
  const status = statuses.get(projectId);
  if (!status)
    throw new Error(
      "Choose a project folder for indexing. Home directories and filesystem roots cannot be indexed.",
    );
  return {
    ...status,
    ...(fixture.defaultsVersion
      ? {
          defaults: {
            enabled: fixture.settings!.projectIndexingEnabled,
            modelSelection: fixture.settings!.projectIndexingDefaultModelSelection,
          },
        }
      : {}),
  };
}

function publish(projectId: ProjectId) {
  for (const listener of listeners.get(projectId) ?? [])
    listener({ type: "status", status: statusFor(projectId) });
}

function Harness({ withProjects = false }: { withProjects?: boolean }) {
  return (
    <div>
      <ProjectIndexingGlobalSettings environmentId={environmentId} />
      {withProjects
        ? projects.map((project) => (
            <ProjectIndexingSettingsController
              key={project.id}
              api={fixture.api!}
              environmentId={environmentId}
              projectId={project.id}
              projectLabel={project.title}
              environmentLabel="Environment"
              projectIndexingVersion={3}
              providers={providers}
              onOpenSource={() => undefined}
            />
          ))
        : null}
    </div>
  );
}

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.defaultsVersion = 1;
  fixture.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    projectIndexingEnabled: false,
    projectIndexingDefaultModelSelection: null,
  };
  fixture.navigate.mockClear();
  statuses.clear();
  listeners.clear();
  for (const project of projects)
    statuses.set(project.id, {
      version: 1,
      scope: { projectId: project.id, scopeId: project.id, workspaceFingerprint: project.id },
      revision: 0,
      state: "idle",
      settings: {
        enabled: true,
        autoRefresh: true,
        reviewEnabled: true,
        modelSelection: project.id === firstProject ? null : model("model-b"),
      },
      job: null,
      coverage: EMPTY_PROJECT_INDEX_COVERAGE,
      gaps: [],
      updatedAt: "2026-09-21T00:00:00.000Z",
    });
  fixture.api = {
    getSettings: vi.fn(async ({ projectId }) => statusFor(projectId).settings),
    getStatus: vi.fn(async ({ projectId }) => statusFor(projectId)),
    updateSettings: vi.fn(async ({ projectId, patch }) => {
      const previous = statuses.get(projectId)!;
      statuses.set(projectId, { ...previous, settings: { ...previous.settings, ...patch } });
      publish(projectId);
      return statusFor(projectId);
    }),
    start: vi.fn(async ({ projectId }) => statusFor(projectId)),
    control: vi.fn(async ({ projectId }) => statusFor(projectId)),
    query: vi.fn<ProjectIndexClientApi["query"]>(),
    checkModel: vi.fn(async () => ({ supported: true })),
    subscribe: vi.fn(({ projectId }, listener) => {
      const group = listeners.get(projectId) ?? new Set();
      group.add(listener);
      listeners.set(projectId, group);
      return () => {
        group.delete(listener);
      };
    }),
  };
  fixture.save.mockReset();
  fixture.save.mockImplementation(
    async ({ input }: { input: { patch: Partial<UnifiedSettings> } }) => {
      fixture.settings = { ...fixture.settings!, ...input.patch };
      for (const project of projects) publish(project.id);
      return { _tag: "Success", value: { settings: fixture.settings } };
    },
  );
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

function globalPanel() {
  return renderer!.root.findByType(ProjectIndexingGlobalSettings);
}
function projectPanel(projectId: ProjectId) {
  return renderer!.root
    .findAllByType(ProjectIndexingSettingsController)
    .find((panel) => panel.props.projectId === projectId)!;
}
function button(panel: ReactTestInstance, label: string) {
  return panel.findAllByType("button").find((candidate) => candidate.children.includes(label))!;
}
function checkbox(panel: ReactTestInstance, label: string) {
  return panel.findAllByType("input").find((input) => input.props["aria-label"] === label)!;
}
function picker(panel: ReactTestInstance, label: string) {
  return panel.findAllByType("select").find((select) => select.props["aria-label"] === label)!;
}

describe("global project indexing defaults", () => {
  it("edits global defaults independently while two projects inherit or override the model", async () => {
    await act(() => {
      renderer = create(<Harness />);
    });
    expect(fixture.api!.getStatus).not.toHaveBeenCalled();
    expect(fixture.api!.subscribe).not.toHaveBeenCalled();
    expect(
      checkbox(globalPanel(), "Enable project indexing on this environment").props.checked,
    ).toBe(false);
    await act(() => renderer!.update(<Harness withProjects />));
    const originalFirst = statuses.get(firstProject)!.settings;
    const originalSecond = statuses.get(secondProject)!.settings;
    await act(() =>
      checkbox(globalPanel(), "Enable project indexing on this environment").props.onChange({
        currentTarget: { checked: true },
      }),
    );
    await act(() =>
      picker(globalPanel(), "Default AI review model").props.onChange({
        currentTarget: { value: "model-a" },
      }),
    );
    expect(fixture.api!.checkModel).toHaveBeenCalledWith({ modelSelection: model("model-a") });
    expect(picker(projectPanel(firstProject), "AI review model").props.value).toBe("model-a");
    expect(picker(projectPanel(secondProject), "AI review model").props.value).toBe("model-b");
    expect(statuses.get(firstProject)!.settings).toBe(originalFirst);
    expect(statuses.get(secondProject)!.settings).toBe(originalSecond);
    expect(fixture.api!.updateSettings).not.toHaveBeenCalled();

    await act(() =>
      picker(globalPanel(), "Default AI review model").props.onChange({
        currentTarget: { value: "model-c" },
      }),
    );
    expect(picker(projectPanel(firstProject), "AI review model").props.value).toBe("model-c");
    expect(picker(projectPanel(secondProject), "AI review model").props.value).toBe("model-b");
    await act(() =>
      picker(projectPanel(firstProject), "AI review model").props.onChange({
        currentTarget: { value: "model-a" },
      }),
    );
    expect(fixture.api!.updateSettings).toHaveBeenLastCalledWith({
      projectId: firstProject,
      patch: { modelSelection: model("model-a") },
    });
    expect(statuses.get(secondProject)!.settings).toBe(originalSecond);
    await act(() => button(projectPanel(firstProject), "Use environment default").props.onClick());
    expect(statuses.get(firstProject)!.settings.modelSelection).toBeNull();
    expect(picker(projectPanel(firstProject), "AI review model").props.value).toBe("model-c");
    await act(() =>
      checkbox(globalPanel(), "Enable project indexing on this environment").props.onChange({
        currentTarget: { checked: false },
      }),
    );
    for (const project of projects) {
      expect(checkbox(projectPanel(project.id), "Enable project indexing").props.checked).toBe(
        true,
      );
      expect(button(projectPanel(project.id), "Index project").props.disabled).toBe(true);
    }
    expect(fixture.api!.start).not.toHaveBeenCalled();
  });

  it("requires explicit project selection when environment defaults are unavailable", async () => {
    fixture.defaultsVersion = 0;
    await act(() => {
      renderer = create(<Harness />);
    });
    expect(fixture.api!.getStatus).not.toHaveBeenCalled();
    expect(fixture.save).not.toHaveBeenCalled();
    expect(globalPanel().findAllByType(ProjectIndexingSettingsController)).toHaveLength(0);
    await act(() =>
      globalPanel()
        .findAllByType("select")[1]!
        .props.onChange({ currentTarget: { value: firstProject } }),
    );
    expect(fixture.api!.getStatus).toHaveBeenCalledWith({ projectId: firstProject });
    expect(fixture.save).not.toHaveBeenCalled();
    expect(picker(projectPanel(firstProject), "AI review model").props.value).toBe("");
  });

  it("shows only scope error recovery when a project is invalid", async () => {
    await act(() => {
      renderer = create(
        <ProjectIndexingSettingsController
          api={fixture.api!}
          environmentId={environmentId}
          projectId={ProjectId.make("invalid-root")}
          projectLabel="Invalid"
          environmentLabel="Environment"
          projectIndexingVersion={3}
          providers={providers}
          onOpenSource={() => undefined}
        />,
      );
    });
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    expect(renderer!.root.findAllByType("select")).toHaveLength(0);
    expect(
      renderer!.root.findAllByType("button").map((candidate) => candidate.children.join("")),
    ).toEqual(["Retry"]);
    expect(fixture.api!.start).not.toHaveBeenCalled();
  });

  it("resumes a paused index regardless of the optional review model", async () => {
    fixture.settings = {
      ...fixture.settings!,
      projectIndexingEnabled: true,
      projectIndexingDefaultModelSelection: null,
    };
    const previous = statuses.get(firstProject)!;
    statuses.set(firstProject, {
      ...previous,
      state: "paused",
      job: {
        id: "job",
        generationId: "generation",
        kind: "initial",
        state: "paused",
        phase: "extraction",
        revision: 0,
        modelSelection: null,
        usage: EMPTY_PROJECT_INDEX_USAGE,
        units: { pending: 1, running: 0, completed: 0, failed: 0, stale: 0, cancelled: 0 },
        updatedAt: previous.updatedAt,
      },
    });
    await act(() => {
      renderer = create(<Harness withProjects />);
    });
    expect(fixture.api!.checkModel).not.toHaveBeenCalledWith({
      projectId: firstProject,
      modelSelection: model("model-a"),
    });
    expect(button(projectPanel(firstProject), "Resume indexing").props.disabled).toBe(false);
    await act(() =>
      picker(projectPanel(firstProject), "AI review model").props.onChange({
        currentTarget: { value: "model-c" },
      }),
    );
    expect(button(projectPanel(firstProject), "Resume indexing").props.disabled).toBe(false);
    await act(() => button(projectPanel(firstProject), "Resume indexing").props.onClick());
    expect(fixture.api!.control).toHaveBeenLastCalledWith({
      projectId: firstProject,
      action: "resume",
    });
  });
});
