import type { ProjectIndexClientApi } from "@t3tools/client-runtime/project-indexing";
import {
  EMPTY_PROJECT_INDEX_COVERAGE,
  EnvironmentId,
  ProjectId,
  type ProjectEntityV1,
  type ProjectIndexQueryResultV1,
  type ProjectContextInput,
} from "@t3tools/contracts";
import { act, cloneElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
  return { useInterfaceTranslator: () => translator };
});
vi.mock("../ui/input", () => ({
  Input: ({ size: _size, ...props }: ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("../ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}));
vi.mock("../ui/button", () => ({
  Button: ({
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & { size?: string; variant?: string }) => <button {...props} />,
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, undefined, children),
  TooltipPopup: () => null,
}));

import { ProjectIndexEntityBrowser } from "./ProjectIndexEntityBrowser";

const environmentId = EnvironmentId.make("environment-remote");
const scope = { projectId: ProjectId.make("project-a") };
const sourceRange = { startLine: 17, startColumn: 3, endLine: 24, endColumn: 2 };

function entity(name: string): ProjectEntityV1 {
  return {
    id: name,
    name,
    qualifiedName: name,
    filePath: `src/${name}.ts`,
    kind: "function",
    language: "typescript",
    range: sourceRange,
    sourceHash: "source-hash",
    provenance: "compiler",
    freshness: "current",
    evidenceIds: [],
  };
}

function result(entities: ReadonlyArray<ProjectEntityV1>): ProjectIndexQueryResultV1 {
  return {
    version: 1,
    scope: { ...scope, scopeId: "scope-a", workspaceFingerprint: "workspace-a" },
    revision: 1,
    operation: "overview",
    summary: "",
    entities,
    callsites: [],
    modules: [],
    behaviors: [],
    flows: [],
    rules: [],
    evidence: [],
    gaps: [],
    coverage: EMPTY_PROJECT_INDEX_COVERAGE,
    nextCursor: null,
    truncated: false,
    estimatedTokens: 100,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function createApi(): ProjectIndexClientApi {
  return {
    getSettings: vi.fn<ProjectIndexClientApi["getSettings"]>(),
    getStatus: vi.fn<ProjectIndexClientApi["getStatus"]>(),
    updateSettings: vi.fn<ProjectIndexClientApi["updateSettings"]>(),
    start: vi.fn<ProjectIndexClientApi["start"]>(),
    control: vi.fn<ProjectIndexClientApi["control"]>(),
    checkModel: vi.fn<ProjectIndexClientApi["checkModel"]>(),
    subscribe: vi.fn(() => () => undefined),
    query: vi.fn<ProjectIndexClientApi["query"]>().mockResolvedValue(result([])),
  };
}

function content(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string {
  if (node === null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(content).join(" ");
  return (node.children ?? []).map(content).join(" ");
}

let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("ProjectIndexEntityBrowser", () => {
  it("expands folders, files and classes in place, preserving siblings and collapsing descendants", async () => {
    const api = createApi();
    const classEntity = { ...entity("Handler"), kind: "class" as const };
    const method = {
      ...entity("handle"),
      filePath: classEntity.filePath,
      containerId: classEntity.id,
      kind: "method" as const,
    };
    const query = vi.fn(
      async (request: ProjectContextInput): Promise<ProjectIndexQueryResultV1> => {
        const path = request.scopes?.[0];
        if (path === "src/Handler.ts") return result([classEntity, method]);
        return {
          ...result([]),
          nextCursor: request.cursor ? null : "next",
          ...(request.cursor
            ? {}
            : {
                graph: {
                  basis: "published-index" as const,
                  rootPath: path ?? "",
                  indexedFiles: 5_000,
                  omittedFiles: 0,
                  truncated: false,
                  nodes:
                    path === "src"
                      ? [{ path: "src/Handler.ts", kind: "file" as const, fileCount: 1 }]
                      : [
                          { path: "src", kind: "directory" as const, fileCount: 4_999 },
                          { path: "README.md", kind: "file" as const, fileCount: 1 },
                        ],
                  edges: [],
                },
              }),
        };
      },
    );
    await act(() => {
      renderer = create(
        <ProjectIndexEntityBrowser
          api={api}
          query={query}
          environmentId={environmentId}
          scope={scope}
          workspaceFingerprint="workspace-a"
          revision={1}
          invalidationEpoch={0}
          onOpenSource={() => undefined}
        />,
      );
    });
    const node = (label: string) =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props["aria-label"] === label)!;
    expect(content(renderer!.toJSON())).toContain("5,000");
    await act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.children.includes("Next page"))!
        .props.onClick(),
    );
    expect(content(renderer!.toJSON())).toContain("5,000");
    await act(() => node("src").props.onClick());
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: "overview", scopes: ["src"] }),
    );
    expect(node("src").props["aria-expanded"]).toBe(true);
    expect(node("README.md")).toBeDefined();
    await act(() => node("src/Handler.ts").props.onClick());
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: "overview", scopes: ["src/Handler.ts"] }),
    );
    expect(node("Handler · src/Handler.ts:17")).toBeDefined();
    expect(node("handle · src/Handler.ts:17")).toBeUndefined();
    await act(() => node("Handler · src/Handler.ts:17").props.onClick());
    expect(node("handle · src/Handler.ts:17")).toBeDefined();
    expect(node("README.md")).toBeDefined();
    await act(() => node("src").props.onClick());
    expect(node("src").props["aria-expanded"]).toBe(false);
    expect(node("src/Handler.ts")).toBeUndefined();
    expect(node("handle · src/Handler.ts:17")).toBeUndefined();
    expect(node("README.md")).toBeDefined();
    expect(renderer!.root.findAllByType("input")[0]!.props.value).toBe("");
  });

  it("discards an in-flight branch when the project or published revision changes", async () => {
    const api = createApi();
    const pending = deferred<ProjectIndexQueryResultV1>();
    const overview: ProjectIndexQueryResultV1 = {
      ...result([]),
      graph: {
        basis: "published-index",
        rootPath: "",
        indexedFiles: 1,
        omittedFiles: 0,
        truncated: false,
        nodes: [{ path: "src", kind: "directory", fileCount: 1 }],
        edges: [],
      },
    };
    const query = vi.fn(async (request: ProjectContextInput) =>
      request.scopes ? pending.promise : overview,
    );
    const render = (revision: number) => (
      <ProjectIndexEntityBrowser
        api={api}
        query={query}
        environmentId={environmentId}
        scope={scope}
        workspaceFingerprint="workspace-a"
        revision={revision}
        invalidationEpoch={0}
        onOpenSource={() => undefined}
      />
    );
    await act(() => {
      renderer = create(render(1));
    });
    await act(() =>
      renderer!.root
        .findAllByType("button")
        .find((node) => node.props["aria-label"] === "src")!
        .props.onClick(),
    );
    await act(() => renderer!.update(render(2)));
    await act(() =>
      pending.resolve({
        ...overview,
        graph: {
          ...overview.graph!,
          rootPath: "src",
          nodes: [{ path: "src/obsolete.ts", kind: "file", fileCount: 1 }],
        },
      }),
    );
    expect(content(renderer!.toJSON())).not.toContain("obsolete.ts");
    expect(content(renderer!.toJSON())).not.toContain("Loading src");
  });

  it("keeps the map usable after an expansion error and retries the branch", async () => {
    const api = createApi();
    const overview: ProjectIndexQueryResultV1 = {
      ...result([]),
      graph: {
        basis: "published-index",
        rootPath: "",
        indexedFiles: 1,
        omittedFiles: 0,
        truncated: false,
        nodes: [{ path: "src", kind: "directory", fileCount: 1 }],
        edges: [],
      },
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce(overview)
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce({
        ...overview,
        graph: {
          ...overview.graph!,
          rootPath: "src",
          nodes: [{ path: "src/recovered.ts", kind: "file", fileCount: 1 }],
        },
      });
    await act(() => {
      renderer = create(
        <ProjectIndexEntityBrowser
          api={api}
          query={query}
          environmentId={environmentId}
          scope={scope}
          workspaceFingerprint="workspace-a"
          revision={1}
          invalidationEpoch={0}
          onOpenSource={() => undefined}
        />,
      );
    });
    const folder = () =>
      renderer!.root.findAllByType("button").find((node) => node.props["aria-label"] === "src")!;
    await act(() => folder().props.onClick());
    expect(content(renderer!.toJSON())).toContain("Connection lost");
    await act(() => folder().props.onClick());
    expect(content(renderer!.toJSON())).toContain("recovered.ts");
    expect(content(renderer!.toJSON())).not.toContain("Connection lost");
  });

  it("keeps newer search results when an older remote search completes later", async () => {
    const api = createApi();
    const older = deferred<ProjectIndexQueryResultV1>();
    const newer = deferred<ProjectIndexQueryResultV1>();
    const query = vi
      .fn()
      .mockResolvedValueOnce(result([]))
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    await act(() => {
      renderer = create(
        <ProjectIndexEntityBrowser
          api={api}
          query={query}
          environmentId={environmentId}
          scope={scope}
          workspaceFingerprint="workspace-a"
          revision={1}
          invalidationEpoch={0}
          onOpenSource={() => undefined}
        />,
      );
    });
    await act(() =>
      renderer!.root.findAllByType("input")[0]!.props.onChange({ currentTarget: { value: "old" } }),
    );
    await act(() =>
      renderer!.root.findAllByType("input")[0]!.props.onChange({ currentTarget: { value: "new" } }),
    );
    await act(() => newer.resolve(result([entity("FreshFunction")])));
    expect(content(renderer!.toJSON())).toContain("FreshFunction");
    await act(() => older.resolve(result([entity("ObsoleteFunction")])));
    expect(content(renderer!.toJSON())).toContain("FreshFunction");
    expect(content(renderer!.toJSON())).not.toContain("ObsoleteFunction");
    expect(query.mock.calls[2]?.[0]).toMatchObject({
      operation: "search",
      text: "new",
      limit: 48,
      maxTokens: 6_000,
    });
  });

  it("refreshes bounded results on same-revision invalidation and loads exact source details on demand", async () => {
    const api = createApi();
    const source = entity("ReadProject");
    const query = vi.fn().mockResolvedValue(result([source]));
    vi.mocked(api.query).mockImplementation(async (request) => ({
      ...result([source]),
      operation: request.operation,
    }));
    const openSource = vi.fn();
    const render = (invalidationEpoch: number) => (
      <ProjectIndexEntityBrowser
        api={api}
        query={query}
        environmentId={environmentId}
        scope={scope}
        workspaceFingerprint="workspace-a"
        revision={1}
        invalidationEpoch={invalidationEpoch}
        onOpenSource={openSource}
      />
    );
    await act(() => {
      renderer = create(render(0));
    });
    expect(api.query).not.toHaveBeenCalled();
    await act(() => renderer!.update(render(1)));
    expect(query).toHaveBeenCalledTimes(2);
    await act(() => renderer!.update(render(1)));
    expect(query).toHaveBeenCalledTimes(2);

    const sourceButton = renderer!.root
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "ReadProject · src/ReadProject.ts:17");
    await act(() => sourceButton!.props.onClick());
    expect(vi.mocked(api.query).mock.calls.map(([request]) => request.operation)).toEqual([
      "entity",
      "callers",
      "callees",
    ]);
    expect(
      vi
        .mocked(api.query)
        .mock.calls.every(
          ([request]) => request.projectId === scope.projectId && request.limit === 48,
        ),
    ).toBe(true);
    const sourceLink = renderer!.root
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "src/ReadProject.ts:17:3");
    await act(() => sourceLink!.props.onClick());
    expect(openSource).toHaveBeenCalledWith("src/ReadProject.ts", 17);
    const close = renderer!.root
      .findAllByType("button")
      .find((candidate) => candidate.children.includes("Close"))!;
    await act(() => close.props.onClick());
    expect(renderer!.root.findAllByType("article")).toHaveLength(0);
  });

  it("rejects records from an obsolete workspace fingerprint", async () => {
    const api = createApi();
    const query = vi.fn().mockResolvedValue(result([entity("OldWorkspaceEntity")]));
    await act(() => {
      renderer = create(
        <ProjectIndexEntityBrowser
          api={api}
          query={query}
          environmentId={environmentId}
          scope={scope}
          workspaceFingerprint="workspace-b"
          revision={1}
          invalidationEpoch={0}
          onOpenSource={() => undefined}
        />,
      );
    });
    expect(content(renderer!.toJSON())).toContain("The project workspace changed");
    expect(content(renderer!.toJSON())).not.toContain("OldWorkspaceEntity");
  });

  it("shows verification only when the query supplies evidence", async () => {
    const api = createApi();
    const verified = {
      ...result([entity("CurrentSource")]),
      verification: {
        context: "provided" as const,
        sourceHashes: {
          state: "complete" as const,
          matchedFiles: 2,
          changedFiles: 1,
          missingFiles: 1,
          unverifiedFiles: 0,
        },
        checks: "not-run" as const,
      },
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce(verified)
      .mockResolvedValueOnce(result([entity("CurrentSourceWithoutProof")]));
    await act(() => {
      renderer = create(
        <ProjectIndexEntityBrowser
          api={api}
          query={query}
          environmentId={environmentId}
          scope={scope}
          workspaceFingerprint="workspace-a"
          revision={1}
          invalidationEpoch={0}
          onOpenSource={() => undefined}
        />,
      );
    });
    expect(content(renderer!.toJSON())).toContain("Project context provided");
    expect(content(renderer!.toJSON())).toContain("Source hashes checked");
    expect(content(renderer!.toJSON())).toContain(
      "2 matched · 1 changed · 1 missing · 0 unverified",
    );
    expect(content(renderer!.toJSON())).toContain("Indexing did not run tests or other checks.");
    await act(() =>
      renderer!.root
        .findAllByType("input")[0]!
        .props.onChange({ currentTarget: { value: "without proof" } }),
    );
    expect(content(renderer!.toJSON())).toContain("CurrentSourceWithoutProof");
    expect(content(renderer!.toJSON())).not.toContain("Verification");
    expect(content(renderer!.toJSON())).not.toContain("Source hashes checked");
    expect(content(renderer!.toJSON())).not.toContain("Indexing did not run tests");
  });

  it("hides search and verification until a published index can be queried", async () => {
    const api = createApi();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ ...result([]), revision: 0 })
      .mockResolvedValueOnce(result([entity("PublishedFunction")]));
    const render = (revision: number) => (
      <ProjectIndexEntityBrowser
        api={api}
        query={query}
        environmentId={environmentId}
        scope={scope}
        workspaceFingerprint="workspace-a"
        revision={revision}
        invalidationEpoch={0}
        onOpenSource={() => undefined}
      />
    );
    await act(() => {
      renderer = create(render(0));
    });
    expect(content(renderer!.toJSON())).toContain("No searchable index yet");
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    expect(content(renderer!.toJSON())).not.toContain("Verification");

    await act(() => renderer!.update(render(1)));
    expect(content(renderer!.toJSON())).toContain("PublishedFunction");
    expect(renderer!.root.findAllByType("input")).not.toHaveLength(0);
  });

  it("shows manifest packages, imports, and explicit rules while hiding old AI descriptions", async () => {
    const api = createApi();
    const sourceEntity = entity("EntryPoint");
    const facts: ProjectIndexQueryResultV1 = {
      ...result([sourceEntity]),
      modules: [
        {
          id: "package-a",
          name: "App package",
          summary: "package.json",
          entityIds: [],
          filePaths: ["package.json"],
          dependsOnModuleIds: [],
          evidenceIds: [],
          freshness: "current",
          provenance: "parser",
        },
        {
          id: "old-ai-module",
          name: "Invented module",
          summary: "An AI description",
          entityIds: [],
          filePaths: [],
          dependsOnModuleIds: [],
          evidenceIds: [],
          freshness: "current",
          provenance: "llm",
        },
      ],
      imports: [
        {
          id: "import-a",
          filePath: sourceEntity.filePath,
          sourceHash: sourceEntity.sourceHash,
          range: sourceRange,
          importText: "import { parse } from './parse'",
          specifier: "./parse",
          resolution: "workspace",
          targetPath: "src/parse.ts",
          provenance: "parser",
          freshness: "current",
          evidenceIds: [],
        },
      ],
      flows: [
        {
          id: "old-ai-flow",
          name: "Invented flow",
          summary: "An AI flow",
          entryEntityIds: [],
          exitEntityIds: [],
          steps: [],
          provenance: "llm",
          freshness: "current",
          evidenceIds: [],
        },
      ],
      rules: [
        {
          id: "rule-a",
          name: "AGENTS.md",
          description: "Use explicit source facts.",
          severity: "info",
          source: "explicit",
          appliesToEntityIds: [],
          provenance: "parser",
          freshness: "current",
          evidenceIds: ["rule-source"],
        },
      ],
      evidence: [
        {
          id: "rule-source",
          filePath: "AGENTS.md",
          range: sourceRange,
          sourceHash: "rule-hash",
          provenance: "parser",
        },
      ],
    };
    const query = vi.fn().mockResolvedValue(facts);
    const openSource = vi.fn();
    await act(() => {
      renderer = create(
        <ProjectIndexEntityBrowser
          api={api}
          query={query}
          environmentId={environmentId}
          scope={scope}
          workspaceFingerprint="workspace-a"
          revision={1}
          invalidationEpoch={0}
          onOpenSource={openSource}
        />,
      );
    });
    const markup = content(renderer!.toJSON());
    expect(markup).toContain("App package");
    expect(markup).toContain("src/parse.ts");
    expect(markup).toContain("Use explicit source facts.");
    expect(markup).not.toContain("Invented module");
    expect(markup).not.toContain("Invented flow");
    const source = renderer!.root
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "AGENTS.md:17:3")!;
    await act(() => source.props.onClick());
    expect(openSource).toHaveBeenCalledWith("AGENTS.md", 17);
  });

  it("keeps entity identity while following real cursors and requesting bounded larger context", async () => {
    const api = createApi();
    const target = { ...entity("Increment"), containerId: "entity:opaque-hash" };
    const container = { ...entity("Counter"), id: target.containerId, kind: "class" as const };
    const largerPage = deferred<ProjectIndexQueryResultV1>();
    const behavior = {
      id: "increment-behavior",
      entityIds: [target.id],
      summary: "Adds one to the supplied value.",
      inputs: ["value"],
      outputs: ["incremented value"],
      sideEffects: [],
      errorPaths: [],
      invariants: [],
      evidenceIds: [],
      freshness: "current" as const,
      provenance: "llm" as const,
    };
    vi.mocked(api.query).mockImplementation(async (request) => {
      if (request.operation !== "entity")
        return { ...result([target]), operation: request.operation };
      if (request.entityId === container.id) return { ...result([container]), operation: "entity" };
      if (request.cursor) return { ...result([]), operation: "entity", truncated: false };
      if (request.maxTokens === 12_000) return largerPage.promise;
      if (request.maxTokens === 24_000)
        return {
          ...result([target, container]),
          operation: "entity",
          behaviors: [behavior],
          truncated: true,
          nextCursor: "max-budget-page",
        };
      return {
        ...result([target]),
        operation: "entity",
        truncated: true,
        nextCursor: "related-page-2",
      };
    });
    const query = vi.fn().mockResolvedValue(result([target]));
    await act(() => {
      renderer = create(
        <ProjectIndexEntityBrowser
          api={api}
          query={query}
          environmentId={environmentId}
          scope={scope}
          workspaceFingerprint="workspace-a"
          revision={1}
          invalidationEpoch={0}
          onOpenSource={() => undefined}
        />,
      );
    });
    const select = renderer!.root
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "Increment · src/Increment.ts:17")!;
    await act(() => select.props.onClick());
    const article = renderer!.root.findByType("article");
    const button = (label: string) =>
      renderer!.root
        .findAllByType("button")
        .find((candidate) => candidate.children.includes(label))!;
    expect(content(renderer!.toJSON())).toContain("Load containing entity");
    expect(content(renderer!.toJSON())).not.toContain("entity:opaque-hash");

    await act(() => button("Next page").props.onClick());
    expect(renderer!.root.findByType("article")).toBe(article);
    expect(renderer!.root.findByType("article").props["aria-label"]).toBe("Increment");
    await act(() => button("Load more entity context").props.onClick());
    expect(renderer!.root.findByType("article")).toBe(article);
    expect(button("Load more entity context").props.disabled).toBe(true);
    await act(() =>
      largerPage.resolve({
        ...result([target, container]),
        operation: "entity",
        behaviors: [behavior],
        truncated: true,
      }),
    );
    expect(renderer!.root.findByType("article")).toBe(article);
    expect(content(renderer!.toJSON())).not.toContain("Adds one to the supplied value.");
    expect(content(renderer!.toJSON())).toContain("Defined in Counter");
    await act(() => button("Load more entity context").props.onClick());
    expect(renderer!.root.findByType("article")).toBe(article);
    expect(
      renderer!.root
        .findAllByType("button")
        .some((candidate) => candidate.children.includes("Load more entity context")),
    ).toBe(false);
    await act(() => button("Next page").props.onClick());
    expect(renderer!.root.findByType("article")).toBe(article);
    expect(content(renderer!.toJSON())).toContain("Freshness unknown");
    await act(() => button("First page").props.onClick());
    expect(renderer!.root.findByType("article")).toBe(article);
    expect(content(renderer!.toJSON())).not.toContain("Adds one to the supplied value.");
    const entityQueries = vi
      .mocked(api.query)
      .mock.calls.map(([request]) => request)
      .filter((request) => request.operation === "entity");
    expect(
      entityQueries.map((request) => [request.maxTokens, request.limit, request.cursor ?? null]),
    ).toEqual([
      [6_000, 48, null],
      [6_000, 48, "related-page-2"],
      [12_000, 96, null],
      [24_000, 192, null],
      [24_000, 192, "max-budget-page"],
      [24_000, 192, null],
    ]);
    expect(
      vi.mocked(api.query).mock.calls.filter(([request]) => request.operation !== "entity"),
    ).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("composes a focused call graph from detail queries and follows its caller node", async () => {
    const api = createApi();
    const increment = entity("Increment");
    const caller = entity("Result");
    const callsite = {
      id: "result-to-increment",
      callerEntityId: caller.id,
      targetEntityIds: [increment.id],
      filePath: caller.filePath,
      range: sourceRange,
      expression: "increment(value)",
      dispatch: "direct" as const,
      resolution: "resolved" as const,
      sourceHash: "hash",
      freshness: "current" as const,
      provenance: "compiler" as const,
      evidenceIds: [],
    };
    const query = vi.fn().mockResolvedValue(result([increment]));
    vi.mocked(api.query).mockImplementation(async (request) => ({
      ...result(
        request.operation === "entity"
          ? [request.entityId === caller.id ? caller : increment]
          : [caller, increment],
      ),
      operation: request.operation,
      callsites: [callsite],
    }));
    await act(() => {
      renderer = create(
        <ProjectIndexEntityBrowser
          api={api}
          query={query}
          environmentId={environmentId}
          scope={scope}
          workspaceFingerprint="workspace-a"
          revision={1}
          invalidationEpoch={0}
          onOpenSource={() => undefined}
        />,
      );
    });
    await act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.props["aria-label"] === "Increment · src/Increment.ts:17")!
        .props.onClick(),
    );
    const article = renderer!.root.findByType("article");
    const graph = article
      .findAllByType("section")
      .find((section) => section.props["aria-label"] === "Knowledge Graph")!;
    expect(
      graph.findAllByType("path").filter((path) => path.props.markerEnd !== undefined),
    ).toHaveLength(1);
    const callerNode = graph
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "Result · src/Result.ts:17")!;
    expect(api.query).toHaveBeenCalledTimes(3);
    await act(() => callerNode.props.onClick());
    expect(renderer!.root.findByType("article").props["aria-label"]).toBe("Result");
    expect(
      vi
        .mocked(api.query)
        .mock.calls.slice(3)
        .map(([request]) => [request.operation, request.entityId]),
    ).toEqual([
      ["entity", caller.id],
      ["callers", caller.id],
      ["callees", caller.id],
    ]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each(["callers", "callees"] as const)(
    "pages %s independently and returns to its first page",
    async (operation) => {
      const api = createApi();
      const target = entity("Increment");
      const first = entity("FirstRelation");
      const second = entity("SecondRelation");
      const secondPage = deferred<ProjectIndexQueryResultV1>();
      const relationPage = (
        related: ProjectEntityV1,
        nextCursor: string | null,
      ): ProjectIndexQueryResultV1 => ({
        ...result([target, related]),
        operation,
        nextCursor,
        callsites: [
          {
            id: `call-${related.id}`,
            callerEntityId: operation === "callers" ? related.id : target.id,
            targetEntityIds: [operation === "callers" ? target.id : related.id],
            filePath: related.filePath,
            range: sourceRange,
            expression: `${related.name}()`,
            dispatch: "direct",
            resolution: "resolved",
            sourceHash: "hash",
            provenance: "compiler",
            freshness: "current",
            evidenceIds: [],
          },
        ],
      });
      vi.mocked(api.query).mockImplementation(async (request) => {
        if (request.operation !== operation)
          return { ...result([target]), operation: request.operation };
        if (request.cursor) return secondPage.promise;
        return relationPage(first, `${operation}-next`);
      });
      const query = vi.fn().mockResolvedValue(result([target]));
      await act(() => {
        renderer = create(
          <ProjectIndexEntityBrowser
            api={api}
            query={query}
            environmentId={environmentId}
            scope={scope}
            workspaceFingerprint="workspace-a"
            revision={1}
            invalidationEpoch={0}
            onOpenSource={() => undefined}
          />,
        );
      });
      await act(() =>
        renderer!.root
          .findAllByType("button")
          .find((button) => button.props["aria-label"] === "Increment · src/Increment.ts:17")!
          .props.onClick(),
      );
      const article = renderer!.root.findByType("article");
      const title = operation === "callers" ? "Callers" : "Callees";
      const section = () =>
        article
          .findAllByType("section")
          .find((candidate) => candidate.props["aria-label"] === title)!;
      const button = (label: string) =>
        section()
          .findAllByType("button")
          .find((candidate) => candidate.children.includes(label))!;
      expect(
        section()
          .findAllByType("code")
          .some((code) => code.children.includes("FirstRelation()")),
      ).toBe(true);
      await act(() => button("Next page").props.onClick());
      expect(renderer!.root.findByType("article")).toBe(article);
      expect(section().props["aria-busy"]).toBe(true);
      await act(() => secondPage.resolve(relationPage(second, null)));
      expect(renderer!.root.findByType("article")).toBe(article);
      expect(
        section()
          .findAllByType("code")
          .some((code) => code.children.includes("SecondRelation()")),
      ).toBe(true);
      expect(
        section()
          .findAllByType("code")
          .some((code) => code.children.includes("FirstRelation()")),
      ).toBe(false);
      await act(() => button("First page").props.onClick());
      expect(renderer!.root.findByType("article")).toBe(article);
      expect(
        section()
          .findAllByType("code")
          .some((code) => code.children.includes("FirstRelation()")),
      ).toBe(true);
      expect(
        section()
          .findAllByType("code")
          .some((code) => code.children.includes("SecondRelation()")),
      ).toBe(false);
      const requests = vi.mocked(api.query).mock.calls.map(([request]) => request);
      expect(
        requests
          .filter((request) => request.operation === operation)
          .map((request) => request.cursor ?? null),
      ).toEqual([null, `${operation}-next`, null]);
      expect(requests.filter((request) => request.operation !== operation)).toHaveLength(2);
      expect(
        requests.every(
          (request) =>
            request.maxTokens === 6_000 &&
            request.limit === 48 &&
            request.projectId === scope.projectId,
        ),
      ).toBe(true);
      expect(query).toHaveBeenCalledTimes(1);
    },
  );
});

describe("project graph search", () => {
  it("keeps the project map on an empty search and restores the overview when cleared", async () => {
    const api = createApi();
    const query = vi
      .fn()
      .mockImplementation(async (request) =>
        request.operation === "overview"
          ? result([entity("ProjectEntry")])
          : { ...result([]), operation: "search" },
      );
    await act(() => {
      renderer = create(
        <ProjectIndexEntityBrowser
          api={api}
          query={query}
          environmentId={environmentId}
          scope={scope}
          workspaceFingerprint="workspace-a"
          revision={1}
          invalidationEpoch={0}
          onOpenSource={() => undefined}
        />,
      );
    });
    await act(() =>
      renderer!.root
        .findAllByType("input")[0]!
        .props.onChange({ currentTarget: { value: "no-such-symbol" } }),
    );
    expect(content(renderer!.toJSON())).toContain("No indexed entities match this search.");
    expect(content(renderer!.toJSON())).toContain("ProjectEntry");
    expect(content(renderer!.toJSON())).toContain(
      "The map above still shows the project overview.",
    );
    await act(() =>
      renderer!.root
        .findAllByType("button")
        .find((button) => button.children.includes("Clear search"))!
        .props.onClick(),
    );
    expect(content(renderer!.toJSON())).not.toContain("No indexed entities match this search.");
    expect(content(renderer!.toJSON())).toContain("ProjectEntry");
    expect(query).toHaveBeenCalledTimes(2);
  });
});
