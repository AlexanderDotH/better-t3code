import { act, render as renderTest, type Screen } from "../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { AnimatedHeight } from "./AnimatedHeight";
it("resizes changing content, rebases after disable, and follows a textarea drag directly", async () => {
  await using _fixture = await setupFixture();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let height = 80;
  let notify: () => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly targets = new Set<Element>();
      constructor(callback: ResizeObserverCallback) {
        notify = () =>
          callback(
            Array.from(
              this.targets,
              (target) =>
                ({
                  target,
                  contentRect: target.getBoundingClientRect(),
                }) as ResizeObserverEntry,
            ),
            this as unknown as ResizeObserver,
          );
      }
      observe(target: Element) {
        this.targets.add(target);
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
        disconnect();
      }
    },
  );
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 300, height),
  );
  const host = document.createElement("div");
  document.body.append(host);
  await using screen: Screen = await renderTest(null, {
    container: host,
    /* The fixture exercises local state without router navigation.*/ router: false,
  });
  const render = (enabled: boolean) => (
    <AnimatedHeight enabled={enabled} containMargins>
      <textarea defaultValue="Draft" />
    </AnimatedHeight>
  );
  try {
    await act(async () => {
      await screen.rerender(render(true));
    });
    const shell = host.firstElementChild as HTMLElement;
    expect(shell.style.height).toBe("80px");
    expect(shell.style.overflow).toBe("visible");
    height = 200;
    await act(async () => {
      await notify();
    });
    expect(shell.style.height).toBe("200px");
    expect(shell.style.overflow).toBe("clip");
    height = 100;
    await act(async () => {
      await notify();
    });
    expect(shell.style.height).toBe("100px");
    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      await textarea.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 295,
          clientY: 95,
        }),
      );
    });
    height = 160;
    await act(async () => {
      await notify();
    });
    expect(shell.style.height).toBe("160px");
    expect(shell.style.overflow).toBe("visible");
    expect(shell.className).not.toContain("transition");
    await act(async () => {
      await window.dispatchEvent(new Event("pointerup"));
    });
    await act(async () => {
      await screen.rerender(render(false));
    });
    expect(shell.style.height).toBe("");
    height = 260;
    await act(async () => {
      await screen.rerender(render(true));
    });
    expect(shell.style.height).toBe("260px");
    expect(shell.style.overflow).toBe("visible");
  } finally {
    await act(async () => {
      await screen.unmount();
    });
    host.remove();
  }
  expect(disconnect).toHaveBeenCalled();
});
async function setupFixture() {
  const fixtureResources = new AsyncDisposableStack();
  fixtureResources.defer(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  try {
    return {
      async [Symbol.asyncDispose]() {
        await fixtureResources.disposeAsync();
      },
    };
  } catch (error) {
    await fixtureResources.disposeAsync();
    throw error;
  }
}
