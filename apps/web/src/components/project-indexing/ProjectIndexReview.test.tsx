import type { ProjectIndexClientApi } from "@t3tools/client-runtime/project-indexing";
import {
  EMPTY_PROJECT_INDEX_USAGE,
  ProjectId,
  ProviderInstanceId,
  type ProjectIndexReviewResultV1,
} from "@t3tools/contracts";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
  return { useInterfaceTranslator: () => translator };
});
vi.mock("../ui/button", () => ({
  Button: ({
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & { size?: string; variant?: string }) => <button {...props} />,
}));
vi.mock("../ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
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

import { ProjectIndexReview } from "./ProjectIndexReview";

const scope = { projectId: ProjectId.make("project") };
const range = { startLine: 7, startColumn: 1, endLine: 7, endColumn: 20 };
const result: ProjectIndexReviewResultV1 = {
  version: 1,
  scope: { ...scope, scopeId: "scope", workspaceFingerprint: "workspace" },
  revision: 1,
  selection: "staged",
  diffHash: "diff-hash",
  state: "completed",
  modelSelection: { instanceId: ProviderInstanceId.make("analysis"), model: "selected-model" },
  summary: "Two diff findings",
  gaps: [],
  usage: EMPTY_PROJECT_INDEX_USAGE,
  findings: [
    {
      id: "before",
      filePath: "src/deleted.ts",
      range,
      severity: "warning",
      category: "correctness",
      message: "The removed handler had a cleanup step.",
      evidenceIds: [],
      sourceHash: "old-hash",
      provenance: "llm",
      sourceSide: "before",
      diffExcerpt: "cleanupPendingTasks();",
    },
    {
      id: "after",
      filePath: "src/current.ts",
      range,
      severity: "info",
      category: "testing",
      message: "The new handler needs an integration test.",
      evidenceIds: [],
      sourceHash: "current-hash",
      provenance: "llm",
      sourceSide: "after",
      diffExcerpt: "registerHandler();",
    },
  ],
};

let renderer: ReactTestRenderer | undefined;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("ProjectIndexReview source sides", () => {
  it("reviews only on request and keeps before-change evidence separate from current-file navigation", async () => {
    const review = vi.fn<NonNullable<ProjectIndexClientApi["review"]>>().mockResolvedValue(result);
    const api = { review };
    const openSource = vi.fn();
    await act(() => {
      renderer = create(
        <ProjectIndexReview api={api} scope={scope} disabled={false} onOpenSource={openSource} />,
      );
    });
    expect(review).not.toHaveBeenCalled();
    await act(() =>
      renderer!.root.findByType("select").props.onChange({ currentTarget: { value: "staged" } }),
    );
    const run = renderer!.root
      .findAllByType("button")
      .find((button) => button.children.includes("Review changes"))!;
    await act(() => run.props.onClick());
    expect(review).toHaveBeenCalledWith({ ...scope, selection: "staged" });
    expect(
      renderer!.root.findAllByType("p").some((node) => node.children.includes("Before change")),
    ).toBe(true);
    expect(
      renderer!.root
        .findAllByType("pre")
        .some((node) => node.children.includes("cleanupPendingTasks();")),
    ).toBe(true);
    expect(
      renderer!.root
        .findAllByType("button")
        .some((button) => button.props["aria-label"] === "src/deleted.ts:7:1"),
    ).toBe(false);
    expect(openSource).not.toHaveBeenCalled();
    const currentSource = renderer!.root
      .findAllByType("button")
      .find((button) => button.props["aria-label"] === "src/current.ts:7:1")!;
    await act(() => currentSource.props.onClick());
    expect(openSource).toHaveBeenCalledWith("src/current.ts", 7);

    await act(() =>
      renderer!.update(
        <ProjectIndexReview api={api} scope={scope} disabled onOpenSource={openSource} />,
      ),
    );
    await act(() => run.props.onClick());
    expect(review).toHaveBeenCalledTimes(1);
  });
});
