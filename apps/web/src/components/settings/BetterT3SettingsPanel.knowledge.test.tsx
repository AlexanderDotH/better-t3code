import { RegistryContext } from "@effect/atom-react";
import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  KnowledgeGraphSnapshotV1,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  enabled: false,
  fail: false,
  subscribe: vi.fn(),
  requests: vi.fn(),
}));
vi.mock("../../../../../packages/client-runtime/src/rpc/client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/rpc")>()),
  subscribe: fixture.subscribe,
}));
vi.mock("../../state/knowledgeGraph", async () => {
  const { createKnowledgeGraphEnvironmentAtoms } =
    await import("@t3tools/client-runtime/state/knowledge-graph");
  const { EnvironmentRegistry } = await import("@t3tools/client-runtime/connection");
  const { Atom } = await import("effect/unstable/reactivity");
  const Layer = await import("effect/Layer");
  const runtime = Atom.runtime(
    Layer.succeed(EnvironmentRegistry, {
      followStream: (_environmentId, stream) => stream,
    } as import("@t3tools/client-runtime/connection").EnvironmentRegistry["Service"]),
  );
  return { knowledgeGraphEnvironment: createKnowledgeGraphEnvironmentAtoms(runtime) };
});
vi.mock("../../chatVisualModeSync", () => ({
  useChatVisualMode: () => "current",
  useSetChatVisualMode: () => vi.fn(),
}));
vi.mock("../../projectThreadPreviewSync", () => ({
  useProjectThreadPreviewCount: () => ({ count: 3, setCount: vi.fn() }),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => [{ environmentId: "env-1", id: "project-1", title: "Project" }],
  useThreadShells: () => [],
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../ui/button", () => ({
  Button: (props: { children: ReactNode; onClick: () => void; disabled?: boolean }) => (
    <button {...props} />
  ),
}));
vi.mock("../ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => children,
  SelectTrigger: ({ children }: { children: ReactNode }) => children,
  SelectValue: ({ children }: { children: ReactNode }) => children,
  SelectPopup: () => null,
  SelectItem: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

import { useBetterT3PreparedControls } from "./BetterT3SettingsPanel.controls";
import { buildBetterT3ControlStates } from "./BetterT3SettingsPanel.logic";

const snapshot = Schema.decodeUnknownSync(KnowledgeGraphSnapshotV1)({
  version: 1,
  type: "snapshot",
  revision: 1,
  scope: {
    version: 1,
    scopeId: "scope-1",
    environmentId: "env-1",
    projectId: "project-1",
    effectiveWorkspaceRoot: "/workspace",
    isWorktree: false,
  },
  nodes: [],
  edges: [],
  evidence: [],
  generatedAt: "2026-09-14T10:00:00.000Z",
  status: {
    version: 1,
    scopeId: "scope-1",
    state: "ready",
    revision: 1,
    indexedFileCount: 2,
    nodeCount: 0,
    edgeCount: 0,
    evidenceCount: 0,
    semanticQueueDepth: 0,
    truncated: {
      eligibleFiles: false,
      nodes: false,
      visibleNodes: false,
      omittedFileCount: 0,
      omittedNodeCount: 0,
    },
  },
});
const translate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;

it("loads only while enabled, releases cached errors, retries, and allows local indexing without a provider", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const registry = AtomRegistry.make();
  const updateSettings = vi.fn();
  let renderer: ReactTestRenderer | undefined;
  fixture.subscribe.mockImplementation(() =>
    Stream.suspend(() => {
      fixture.requests();
      if (!fixture.enabled || fixture.fail) return Stream.fail(new Error("Graph unavailable"));
      return Stream.concat(Stream.make(snapshot), Stream.never);
    }),
  );
  function Harness({ enabled }: { enabled: boolean }) {
    const settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      knowledgeGraphModelSelection: {
        instanceId: ProviderInstanceId.make("removed-provider"),
        model: "retired",
      },
      betterT3Environment: {
        ...DEFAULT_UNIFIED_SETTINGS.betterT3Environment,
        flags: { "knowledge.graph": enabled },
      },
    };
    const controls = useBetterT3PreparedControls({
      environmentId: EnvironmentId.make("env-1"),
      settings,
      providers: [],
      translate,
      updateSettings,
      features: buildBetterT3ControlStates({
        registry: BETTER_T3_FEATURE_REGISTRY,
        device: settings.betterT3Device,
        environment: settings.betterT3Environment,
        surface: "web",
        capabilities: { knowledgeGraphVersion: 1 },
      }),
    });
    return (
      <>
        {controls["knowledge.model"]}
        {controls["knowledge.progress"]}
        {controls["knowledge.pause"]}
      </>
    );
  }
  const content = () => (
    <RegistryContext.Provider value={registry}>
      <Harness enabled={fixture.enabled} />
    </RegistryContext.Provider>
  );
  const output = () => JSON.stringify(renderer!.toJSON());
  const button = (label: string) =>
    renderer!.root.findAllByType("button").find((node) => node.children.join("") === label)!;
  try {
    await act(() => {
      renderer = create(content());
    });
    expect(fixture.requests).not.toHaveBeenCalled();
    expect(output()).toContain("Disabled");
    expect(output()).toContain("Configure OpenAI API provider");

    fixture.enabled = true;
    fixture.fail = true;
    await act(() => renderer!.update(content()));
    expect(fixture.requests).toHaveBeenCalledOnce();
    expect(output()).toContain("could not be loaded");
    fixture.enabled = false;
    await act(() => renderer!.update(content()));
    fixture.enabled = true;
    fixture.fail = false;
    await act(() => renderer!.update(content()));
    expect(fixture.requests).toHaveBeenCalledTimes(2);
    expect(output()).toContain("2 indexed files");
    expect(output()).not.toContain("could not be loaded");
    await act(() => button("Local indexing").props.onClick());
    expect(updateSettings).toHaveBeenLastCalledWith({ knowledgeGraphModelSelection: null });

    const { knowledgeGraphEnvironment } = await import("../../state/knowledgeGraph");
    fixture.fail = true;
    await act(() =>
      registry.refresh(
        knowledgeGraphEnvironment.state({
          environmentId: EnvironmentId.make("env-1"),
          input: { scope: { projectId: ProjectId.make("project-1") } },
        }),
      ),
    );
    expect(output()).toContain("could not be loaded");
    fixture.fail = false;
    await act(() => button("Retry").props.onClick());
    expect(output()).toContain("2 indexed files");
    expect(output()).not.toContain("could not be loaded");
  } finally {
    await act(() => renderer?.unmount());
    registry.dispose();
    vi.unstubAllGlobals();
  }
});
