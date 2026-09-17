import { EnvironmentId, ProjectId, type PullRequestCheckLog } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PullRequestJobLogDialog } from "./PullRequestJobLogDialog";

const state = vi.hoisted(() => ({
  query: {
    data: null as PullRequestCheckLog | null,
    error: null as string | null,
    isPending: false,
    refresh: vi.fn(),
  },
}));
vi.mock("~/state/query", () => ({ useEnvironmentQuery: () => state.query }));
vi.mock("~/state/pullRequests", () => ({ pullRequestEnvironment: { checkLog: () => null } }));
vi.mock("~/browser/useOpenLink", () => ({ useOpenLink: () => vi.fn() }));
vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("./pullRequestPresentation", () => ({
  PullRequestCheckStatusIcon: () => null,
  pullRequestCheckStatusLabel: () => "Running",
}));
vi.mock("../ui/dialog", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Container,
    DialogPopup: Container,
    DialogHeader: Container,
    DialogTitle: Container,
    DialogDescription: Container,
  };
});
vi.mock("../ui/button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

const check = { name: "test", status: "pending", description: null, url: null, logId: 7 } as const;
let renderer: ReactTestRenderer;
let visibility: string;
let documentEvents: EventTarget;
const scroll = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 };
const view = () => (
  <PullRequestJobLogDialog
    environmentId={"env" as EnvironmentId}
    reference={{ projectId: "project" as ProjectId, repository: "group/repo", number: 1 }}
    check={check}
    threadRef={null}
    onClose={() => {}}
  />
);
const update = async () => {
  await act(async () => renderer.update(view()));
};
const tick = async () => {
  await act(async () => vi.advanceTimersByTime(5_000));
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visibility = "visible";
  documentEvents = new EventTarget();
  vi.stubGlobal("document", {
    get visibilityState() {
      return visibility;
    },
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  });
  state.query = {
    data: { check, text: "first", complete: false, truncated: false },
    error: null,
    isPending: false,
    refresh: vi.fn(),
  };
  Object.assign(scroll, { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
  await act(async () => {
    renderer = create(view(), {
      createNodeMock: (element) =>
        (element.props as { "aria-label"?: string })["aria-label"] === "Job log" ? scroll : null,
    });
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("job log updates", () => {
  it("refreshes running jobs, waits for in-flight reads, and stops after completion", async () => {
    await tick();
    expect(state.query.refresh).toHaveBeenCalledTimes(1);
    state.query.isPending = true;
    await update();
    await tick();
    expect(state.query.refresh).toHaveBeenCalledTimes(1);
    state.query = {
      ...state.query,
      isPending: false,
      data: { ...state.query.data!, text: "done", complete: true },
    };
    await update();
    await tick();
    expect(state.query.refresh).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType("pre").children).toEqual(["done"]);
  });
  it("pauses hidden windows and cancels updates when closed", async () => {
    visibility = "hidden";
    await act(async () => documentEvents.dispatchEvent(new Event("visibilitychange")));
    await tick();
    expect(state.query.refresh).not.toHaveBeenCalled();
    visibility = "visible";
    await act(async () => documentEvents.dispatchEvent(new Event("visibilitychange")));
    await tick();
    expect(state.query.refresh).toHaveBeenCalledTimes(1);
    state.query.data = { ...state.query.data!, text: "next" };
    await update();
    await act(async () => renderer.unmount());
    await tick();
    expect(state.query.refresh).toHaveBeenCalledTimes(1);
  });
  it("keeps previous output and automatically recovers after errors", async () => {
    state.query.error = "Rate limit exceeded";
    await update();
    await tick();
    expect(state.query.refresh).not.toHaveBeenCalled();
    expect(renderer.root.findByType("pre").children).toEqual(["first"]);
    expect(renderer.root.findByProps({ role: "alert" }).children).toEqual(["Rate limit exceeded"]);
    await tick();
    await tick();
    expect(state.query.refresh).toHaveBeenCalledTimes(1);
    state.query.isPending = true;
    await update();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(state.query.refresh).toHaveBeenCalledTimes(1);
    state.query = {
      ...state.query,
      error: null,
      isPending: false,
      data: { ...state.query.data!, text: "recovered output" },
    };
    await update();
    expect(renderer.root.findByType("pre").children).toEqual(["recovered output"]);
    await tick();
    expect(state.query.refresh).toHaveBeenCalledTimes(2);
  });
  it("continues polling even when the response has not changed", async () => {
    await tick();
    await tick();
    await tick();
    expect(state.query.refresh).toHaveBeenCalledTimes(3);
  });
  it("does not pull a reader back to the end after they scroll up", async () => {
    expect(scroll.scrollTop).toBe(1000);
    scroll.scrollTop = 100;
    await act(async () =>
      renderer.root
        .findByProps({ "aria-label": "Job log" })
        .props.onScroll({ currentTarget: scroll }),
    );
    scroll.scrollHeight = 1200;
    state.query.data = { ...state.query.data!, text: "more output" };
    await update();
    expect(scroll.scrollTop).toBe(100);
    const follow = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("Follow output"))!;
    await act(async () => follow.props.onClick());
    expect(scroll.scrollTop).toBe(1200);
  });
});
