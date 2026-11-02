import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { commands, query } = vi.hoisted(() => ({
  commands: {
    update: vi.fn<(input: unknown) => Promise<unknown>>(),
    replace: vi.fn<(input: unknown) => Promise<unknown>>(),
    import: vi.fn<(input: unknown) => Promise<unknown>>(),
    clear: vi.fn<(input: unknown) => Promise<unknown>>(),
  },
  query: {
    data: {
      settings: { memoryMode: "project", allowAgentWrites: false },
      effectivePath: "/workspace/MEMORY.md",
      rawMarkdown: "Existing memory",
      status: "active",
      storage: "project",
    },
    dataUpdatedAt: 1,
    isPending: false,
    error: null,
    refresh: vi.fn(),
  },
}));

vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => query }));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    projectMemoryView: (target: unknown) => target,
    updateProjectMemorySettings: commands.update,
    replaceProjectMemory: commands.replace,
    importProjectMemory: commands.import,
    clearProjectMemory: commands.clear,
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));
vi.mock("./ProjectMemorySettings", () => ({
  ProjectMemorySettings: ({
    busy,
    onSaveContent,
  }: {
    busy: boolean;
    onSaveContent: (content: string) => void;
  }) => (
    <button disabled={busy} onClick={() => onSaveContent("Remember the API constraint")}>
      Save memory
    </button>
  ),
}));

import { ProjectMemorySettingsController } from "./ProjectMemorySettingsController";

const project = {
  environmentId: EnvironmentId.make("remote-environment"),
  id: ProjectId.make("project-a"),
};

beforeEach(() => {
  // oxlint-disable-next-line t3code/require-disposable-render -- this Node-only controller test uses react-test-renderer for command receipts and has no DOM to pass to the browser renderer
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  for (const command of Object.values(commands))
    command.mockResolvedValue({ _tag: "Success", value: undefined });
});
afterEach(() => vi.unstubAllGlobals());

describe("project memory mutations", () => {
  it("refreshes the destination query only after the save command succeeds and fences duplicate saves", async () => {
    let finishSave!: (result: unknown) => void;
    commands.replace.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSave = resolve;
      }),
    );
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(<ProjectMemorySettingsController project={project} />);
      });
      await act(() => {
        const save = renderer!.root.findByType("button").props.onClick;
        save();
        save();
      });
      expect(commands.replace).toHaveBeenCalledExactlyOnceWith({
        environmentId: project.environmentId,
        input: { projectId: project.id, markdown: "Remember the API constraint" },
      });
      expect(query.refresh).not.toHaveBeenCalled();
      await act(() => {
        finishSave({ _tag: "Success", value: undefined });
      });
      expect(query.refresh).toHaveBeenCalledExactlyOnceWith();
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  it("shows a failed command and keeps the query unchanged until a successful retry", async () => {
    commands.replace.mockResolvedValueOnce({
      _tag: "Failure",
      cause: Cause.fail(new Error("Remote memory is read-only")),
    });
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(<ProjectMemorySettingsController project={project} />);
      });
      await act(() => renderer!.root.findByType("button").props.onClick());
      expect(renderer!.root.findByProps({ role: "alert" }).children).toEqual([
        "Remote memory is read-only",
      ]);
      expect(query.refresh).not.toHaveBeenCalled();
      await act(() => renderer!.root.findByType("button").props.onClick());
      expect(renderer!.root.findAllByProps({ role: "alert" })).toEqual([]);
      expect(query.refresh).toHaveBeenCalledExactlyOnceWith();
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  it("rejects programmatic mutations when the project settings are read-only", async () => {
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(<ProjectMemorySettingsController project={project} readOnly />);
      });
      await act(() => renderer!.root.findByType("button").props.onClick());
      for (const command of Object.values(commands)) expect(command).not.toHaveBeenCalled();
    } finally {
      await act(() => renderer?.unmount());
    }
  });
});
