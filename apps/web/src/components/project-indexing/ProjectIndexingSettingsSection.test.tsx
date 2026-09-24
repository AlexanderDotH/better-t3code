import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { act, useId, useState, type ReactNode } from "react";
import * as Option from "effect/Option";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ProjectIndexingSettingsControllerProps } from "./ProjectIndexingSettingsController";

const fixture = vi.hoisted(() => ({
  environments: [] as Array<{
    environmentId: string;
    label: string;
    connection: { phase: string };
    serverConfig: {
      environment: { capabilities: { projectIndexingVersion: number } };
      providers: never[];
    };
    entry: { target: { _tag: string } };
  }>,
  projects: [] as Array<{
    environmentId: string;
    id: string;
    title: string;
    workspaceRoot: string;
  }>,
  threads: [] as Array<{
    environmentId: string;
    projectId: string;
    id: string;
    title: string;
    worktreePath: string;
    branch: string;
  }>,
  scopes: ["orchestration:read", "orchestration:operate"],
  bind: vi.fn(() => null),
  shellLive: true,
  sessionAvailable: true,
  sessionPending: false,
  authenticated: true,
  sessionError: null as string | null,
}));

vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ status: fixture.shellLive ? "live" : "cached", error: Option.none() }),
}));
vi.mock("../../state/shell", () => ({ environmentShell: { stateValueAtom: (id: string) => id } }));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));
vi.mock("../../hooks/useSettings", () => ({
  usePrimarySettingsAvailable: () => true,
  PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE: "Unavailable",
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: fixture.environments }),
  usePrimaryEnvironmentId: () => fixture.environments[0]?.environmentId ?? null,
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => fixture.projects,
  useThreadShells: () => fixture.threads,
}));
vi.mock("../../state/projectIndexing", () => ({ bindProjectIndexApi: fixture.bind }));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: (id: string) => id },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: fixture.sessionAvailable
      ? { authenticated: fixture.authenticated, scopes: fixture.scopes }
      : null,
    error: fixture.sessionError,
    isPending: fixture.sessionPending,
    refresh: vi.fn(),
  }),
}));
vi.mock("../ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string | null;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
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
vi.mock("./ProjectIndexingSettingsController", () => ({
  ProjectIndexingSettingsController: function ControllerProbe(
    props: ProjectIndexingSettingsControllerProps,
  ) {
    const [search, setSearch] = useState("");
    const inputId = useId();
    return (
      <article aria-label={`${props.environmentId}:${props.projectId}:${props.threadId ?? "root"}`}>
        <input
          id={inputId}
          aria-label="Search index"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <button disabled={!props.canOperate}>Write index</button>
        <button onClick={() => props.onOpenSource("src/example.ts", 7)}>Open source</button>
      </article>
    );
  },
}));
vi.mock("./ProjectIndexSourceDialog", () => ({
  ProjectIndexSourceDialog: (props: {
    environmentId: string;
    workspaceRoot: string;
    path: string;
  }) => (
    <div role="dialog" aria-label={`${props.environmentId}:${props.workspaceRoot}:${props.path}`} />
  ),
}));

import {
  ProjectIndexingProjectSettings,
  ProjectIndexingSettingsSection,
} from "./ProjectIndexingSettingsSection";

const firstEnvironment = EnvironmentId.make("environment-a");
const secondEnvironment = EnvironmentId.make("environment-b");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("worktree-thread");
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.bind.mockClear();
  fixture.shellLive = true;
  fixture.sessionAvailable = true;
  fixture.sessionPending = false;
  fixture.authenticated = true;
  fixture.sessionError = null;
  fixture.scopes = [AuthOrchestrationReadScope, AuthOrchestrationOperateScope];
  fixture.environments = [firstEnvironment, secondEnvironment].map((id) => ({
    environmentId: id,
    label: id,
    connection: { phase: "connected" },
    serverConfig: { environment: { capabilities: { projectIndexingVersion: 3 } }, providers: [] },
    entry: { target: { _tag: "RemoteConnectionTarget" } },
  }));
  fixture.projects = [firstEnvironment, secondEnvironment].map((id) => ({
    environmentId: id,
    id: projectId,
    title: "Project",
    workspaceRoot: `/${id}/project`,
  }));
  fixture.threads = [
    {
      environmentId: firstEnvironment,
      projectId,
      id: threadId,
      title: "Feature work",
      worktreePath: "/environment-a/worktree",
      branch: "feature",
    },
  ];
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("ProjectIndexingSettingsSection", () => {
  it("requires explicit project selection and keeps source reads isolated between environments", async () => {
    await act(() => {
      renderer = create(<ProjectIndexingSettingsSection environmentId={firstEnvironment} />);
    });
    expect(renderer!.root.findAllByType("article")).toHaveLength(0);
    expect(fixture.bind).not.toHaveBeenCalled();
    await act(() =>
      renderer!.root
        .findAllByType("select")[1]!
        .props.onChange({ currentTarget: { value: projectId } }),
    );
    await act(() =>
      renderer!.root
        .findAllByType("select")[2]!
        .props.onChange({ currentTarget: { value: `thread:${threadId}` } }),
    );
    expect(renderer!.root.findByType("article").props["aria-label"]).toBe(
      `${firstEnvironment}:${projectId}:${threadId}`,
    );
    const openSource = () =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.children.includes("Open source"))!
        .props.onClick();
    await act(openSource);
    expect(renderer!.root.findByProps({ role: "dialog" }).props["aria-label"]).toBe(
      "environment-a:/environment-a/worktree:src/example.ts",
    );
    await act(() =>
      renderer!.root
        .findAllByType("select")[0]!
        .props.onChange({ currentTarget: { value: secondEnvironment } }),
    );
    expect(renderer!.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(renderer!.root.findAllByType("article")).toHaveLength(0);
    await act(() =>
      renderer!.root
        .findAllByType("select")[1]!
        .props.onChange({ currentTarget: { value: projectId } }),
    );
    expect(renderer!.root.findByType("article").props["aria-label"]).toBe(
      `${secondEnvironment}:${projectId}:root`,
    );
    await act(openSource);
    expect(renderer!.root.findByProps({ role: "dialog" }).props["aria-label"]).toBe(
      "environment-b:/environment-b/project:src/example.ts",
    );
  });

  it("shows inspection only for read access and mounts no index controller without read permission", async () => {
    fixture.scopes = [AuthOrchestrationReadScope];
    await act(() => {
      renderer = create(
        <ProjectIndexingProjectSettings
          environmentId={firstEnvironment}
          projectId={projectId}
          threadId={threadId}
        />,
      );
    });
    expect(
      renderer!.root
        .findAllByType("button")
        .find((button) => button.children.includes("Write index"))!.props.disabled,
    ).toBe(true);
    fixture.scopes = [];
    fixture.bind.mockClear();
    await act(() =>
      renderer!.update(
        <ProjectIndexingProjectSettings
          environmentId={firstEnvironment}
          projectId={projectId}
          threadId={threadId}
        />,
      ),
    );
    expect(renderer!.root.findAllByType("article")).toHaveLength(0);
    expect(fixture.bind).not.toHaveBeenCalled();
  });

  it("keeps a missing requested worktree unavailable instead of selecting the project root", async () => {
    await act(() => {
      renderer = create(
        <ProjectIndexingSettingsSection
          environmentId={firstEnvironment}
          projectId={projectId}
          threadId={ThreadId.make("missing")}
        />,
      );
    });
    expect(renderer!.root.findAllByType("article")).toHaveLength(0);
    expect(fixture.bind).not.toHaveBeenCalled();
    await act(() =>
      renderer!.root
        .findAllByType("select")[2]!
        .props.onChange({ currentTarget: { value: "project-root" } }),
    );
    expect(renderer!.root.findByType("article").props["aria-label"]).toBe(
      `${firstEnvironment}:${projectId}:root`,
    );
  });

  it("waits for authoritative project and thread metadata before mounting an index", async () => {
    fixture.shellLive = false;
    await act(() => {
      renderer = create(
        <ProjectIndexingProjectSettings
          environmentId={firstEnvironment}
          projectId={projectId}
          threadId={threadId}
        />,
      );
    });
    expect(fixture.bind).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType("article")).toHaveLength(0);
    fixture.shellLive = true;
    await act(() =>
      renderer!.update(
        <ProjectIndexingProjectSettings
          environmentId={firstEnvironment}
          projectId={projectId}
          threadId={threadId}
        />,
      ),
    );
    expect(renderer!.root.findByType("article").props["aria-label"]).toBe(
      `${firstEnvironment}:${projectId}:${threadId}`,
    );
  });

  it("retains the same search input across shell and session refreshes while blocking writes", async () => {
    const element = (
      <ProjectIndexingProjectSettings
        environmentId={firstEnvironment}
        projectId={projectId}
        threadId={threadId}
      />
    );
    await act(() => {
      renderer = create(element);
    });
    const input = renderer!.root.findByType("input");
    const inputId = input.props.id;
    await act(() => input.props.onChange({ currentTarget: { value: "increment" } }));

    fixture.shellLive = false;
    await act(() =>
      renderer!.update(
        <ProjectIndexingProjectSettings
          environmentId={firstEnvironment}
          projectId={projectId}
          threadId={threadId}
        />,
      ),
    );
    expect(renderer!.root.findByType("input")).toBe(input);
    expect(renderer!.root.findByType("input").props.value).toBe("increment");
    expect(
      renderer!.root
        .findAllByType("button")
        .find((button) => button.children.includes("Write index"))!.props.disabled,
    ).toBe(true);

    fixture.shellLive = true;
    fixture.sessionAvailable = false;
    fixture.sessionPending = true;
    await act(() =>
      renderer!.update(
        <ProjectIndexingProjectSettings
          environmentId={firstEnvironment}
          projectId={projectId}
          threadId={threadId}
        />,
      ),
    );
    expect(renderer!.root.findByType("input")).toBe(input);
    expect(renderer!.root.findByType("input").props.id).toBe(inputId);
    expect(renderer!.root.findByType("input").props.value).toBe("increment");

    fixture.sessionAvailable = true;
    fixture.sessionPending = false;
    await act(() =>
      renderer!.update(
        <ProjectIndexingProjectSettings
          environmentId={firstEnvironment}
          projectId={projectId}
          threadId={threadId}
        />,
      ),
    );
    expect(renderer!.root.findByType("input")).toBe(input);
    expect(renderer!.root.findByType("input").props.value).toBe("increment");
    expect(
      renderer!.root
        .findAllByType("button")
        .find((button) => button.children.includes("Write index"))!.props.disabled,
    ).toBe(false);
  });

  it("discards retained state on real authorization loss, disconnection, and workspace changes", async () => {
    const render = () => (
      <ProjectIndexingProjectSettings
        environmentId={firstEnvironment}
        projectId={projectId}
        threadId={threadId}
      />
    );
    const enterSearch = () =>
      renderer!.root.findByType("input").props.onChange({ currentTarget: { value: "increment" } });
    await act(() => {
      renderer = create(render());
    });
    await act(enterSearch);
    fixture.authenticated = false;
    await act(() => renderer!.update(render()));
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    fixture.authenticated = true;
    await act(() => renderer!.update(render()));
    expect(renderer!.root.findByType("input").props.value).toBe("");

    await act(enterSearch);
    fixture.environments[0]!.connection.phase = "disconnected";
    await act(() => renderer!.update(render()));
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    fixture.environments[0]!.connection.phase = "connected";
    await act(() => renderer!.update(render()));
    expect(renderer!.root.findByType("input").props.value).toBe("");

    await act(enterSearch);
    fixture.threads[0]!.worktreePath = "/environment-a/replaced-worktree";
    await act(() => renderer!.update(render()));
    expect(renderer!.root.findByType("input").props.value).toBe("");
  });
});
