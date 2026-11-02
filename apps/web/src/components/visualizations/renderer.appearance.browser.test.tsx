import { type VisualizationAppearance } from "@t3tools/client-runtime/visualizations/model";
import { expect, it, vi } from "vite-plus/test";
import { act, render, stubGlobal } from "../../../test/render";

it("updates all preview appearances from one shared observer and releases it with the last consumer", async () => {
  vi.resetModules();
  const { useVisualizationAppearance } = await import("./useVisualizationAppearance");
  const NativeMutationObserver = MutationObserver;
  const observers: MutationObserver[] = [];
  using observerSpies = new DisposableStack();
  let palette = {
    fontFamily: "  FixtureSans, sans-serif  ",
    background: "#ffffff",
    foreground: "#123456",
    mutedForeground: "#667788",
    surface: "#f4f4f4",
    border: "rgba(0, 0, 0, 0.2)",
    card: "rgba(0, 0, 0, 0.1)",
  };
  using _styles = stubGlobal("getComputedStyle", (element: HTMLElement) => {
    if (element.classList.contains("chat-markdown-codeblock"))
      return { backgroundColor: palette.card };
    const muted = element.style.color === "var(--contrast-muted-foreground)";
    return {
      fontFamily: palette.fontFamily,
      backgroundColor: muted ? palette.surface : palette.background,
      color: muted ? palette.mutedForeground : palette.foreground,
      borderTopColor: palette.border,
    };
  });
  using _observers = stubGlobal(
    "MutationObserver",
    class extends NativeMutationObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        const observer: MutationObserver = this;
        observers.push(observer);
        observerSpies.use(vi.spyOn(observer, "disconnect"));
      }
    },
  );
  const previousClass = document.documentElement.className;
  using _class = {
    [Symbol.dispose]: () => {
      document.documentElement.className = previousClass;
    },
  };
  document.documentElement.classList.remove("dark");
  const appearances = new Map<string, VisualizationAppearance>();
  function PreviewConsumer({ id }: { id: string }) {
    appearances.set(id, useVisualizationAppearance("light"));
    return null;
  }
  const consumers = (ids: string[]) => (
    <>
      {ids.map((id) => (
        <PreviewConsumer key={id} id={id} />
      ))}
    </>
  );
  const bodyChildren = document.body.childElementCount;
  // The appearance hook observes document styles and does not navigate.
  await using screen = await render(consumers(["first", "second"]), { router: false });
  expect(observers).toHaveLength(1);
  expect(appearances.get("first")).toEqual({
    fontFamily: "FixtureSans, sans-serif",
    background: "#e6e6e6",
    foreground: "#123456",
    mutedForeground: "#667788",
    surface: "#f4f4f4",
    border: "#b8b8b8",
  });
  expect(appearances.get("second")).toBe(appearances.get("first"));
  await act(() => {
    palette = {
      fontFamily: "ChangedFixtureSans, sans-serif",
      background: "#222222",
      foreground: "#eeeeee",
      mutedForeground: "#ababab",
      surface: "#444444",
      border: "rgba(255, 255, 255, 0.2)",
      card: "rgba(255, 255, 255, 0.1)",
    };
    document.documentElement.classList.add("dark");
  });
  await vi.waitFor(() =>
    expect(appearances.get("first")).toEqual({
      fontFamily: "ChangedFixtureSans, sans-serif",
      background: "#383838",
      foreground: "#eeeeee",
      mutedForeground: "#ababab",
      surface: "#444444",
      border: "#606060",
    }),
  );
  expect(appearances.get("second")).toBe(appearances.get("first"));
  expect(observers).toHaveLength(1);
  await screen.rerender(consumers(["second"]));
  expect(observers[0]!.disconnect).not.toHaveBeenCalled();
  await screen.unmount();
  expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
  expect(document.body.childElementCount).toBe(bodyChildren + 1);
});
