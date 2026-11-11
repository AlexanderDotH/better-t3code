import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useMacRightPanelWindowExpansion } from "./useMacRightPanelWindowExpansion";

const mockSettings = vi.hoisted(() => ({ sidebarPosition: "left" as "left" | "right" }));

vi.mock("../env", () => ({ isMacElectron: true }));
vi.mock("./useSettings", () => ({
  useClientSettings: (select: (settings: typeof mockSettings) => unknown) => select(mockSettings),
}));

let renderer: ReactTestRenderer;
let expansion: ReturnType<typeof useMacRightPanelWindowExpansion>;
const setWindowExpansion = vi.fn(
  async ({ panelWidth }: { panelWidth: number | null }) => panelWidth !== null,
);
let storedItems: Map<string, string>;
let zoomFactor: number;

function Panel({ open }: { open: boolean }) {
  const result = useMacRightPanelWindowExpansion({
    panelWidthStorageKey: "test-panel-width",
    defaultPanelWidth: 540,
  });
  useLayoutEffect(() => {
    expansion = result;
  });
  return <div data-open={open} />;
}

beforeEach(() => {
  mockSettings.sidebarPosition = "left";
  setWindowExpansion.mockReset();
  setWindowExpansion.mockImplementation(async ({ panelWidth }) => panelWidth !== null);
  storedItems = new Map<string, string>();
  zoomFactor = 1;
  const browserWindow = Object.assign(new EventTarget(), {
    desktopBridge: {
      setRightPanelWindowExpansion: setWindowExpansion,
      getWindowZoomFactor: () => zoomFactor,
    },
    localStorage: {
      getItem: (key: string) => storedItems.get(key) ?? null,
      setItem: (key: string, value: string) => storedItems.set(key, value),
      removeItem: (key: string) => storedItems.delete(key),
    },
  });

  vi.stubGlobal("window", browserWindow);
});

afterEach(async () => {
  await act(async () => {
    await renderer?.unmount();
  });
  vi.unstubAllGlobals();
});

describe("macOS right-panel window expansion", () => {
  it("expands before opening a closed panel, then restores on the next expand-button click", async () => {
    await act(async () => {
      renderer = create(<Panel open={false} />);
    });
    expect(expansion.expanded).toBe(false);
    expect(setWindowExpansion).not.toHaveBeenCalled();

    await act(async () => {
      expect(await expansion.prepareOpen()).toBe(true);
    });
    expect(setWindowExpansion).toHaveBeenCalledExactlyOnceWith({
      panelWidth: 540,
      direction: "right",
    });
    expect(expansion.expanded).toBe(true);

    await act(async () => {
      await renderer.update(<Panel open />);
    });
    expect(setWindowExpansion).toHaveBeenCalledTimes(1);
    await act(async () => {
      await expansion.toggle();
    });
    expect(expansion.expanded).toBe(false);
    expect(setWindowExpansion).toHaveBeenLastCalledWith({ panelWidth: null, direction: "right" });
  });

  it("does not change window size on its own when the panel opens or closes", async () => {
    await act(async () => {
      renderer = create(<Panel open={false} />);
    });
    await act(async () => {
      await renderer.update(<Panel open />);
    });
    expect(setWindowExpansion).not.toHaveBeenCalled();

    await act(async () => {
      await expansion.toggle();
    });
    expect(expansion.expanded).toBe(true);
    await act(async () => {
      await renderer.update(<Panel open={false} />);
    });
    expect(expansion.expanded).toBe(true);
    await act(async () => {
      await renderer.update(<Panel open />);
    });
    expect(setWindowExpansion).toHaveBeenCalledTimes(1);
  });

  it("keeps the button state across a chat or route remount", async () => {
    await act(async () => {
      renderer = create(<Panel open />);
    });
    await act(async () => {
      await expansion.toggle();
    });
    await act(async () => {
      await renderer.unmount();
    });
    await act(async () => {
      renderer = create(<Panel open={false} />);
    });
    expect(expansion.expanded).toBe(true);
    expect(setWindowExpansion).toHaveBeenCalledTimes(1);
  });

  it("expands away from the project sidebar and collapses toward the original side", async () => {
    mockSettings.sidebarPosition = "right";
    await act(async () => {
      renderer = create(<Panel open />);
    });
    await act(async () => {
      await expansion.toggle();
    });
    expect(expansion.direction).toBe("left");
    expect(setWindowExpansion).toHaveBeenLastCalledWith({ panelWidth: 540, direction: "left" });
    expect(expansion.expanded).toBe(true);

    mockSettings.sidebarPosition = "left";
    await act(async () => {
      await renderer.update(<Panel open />);
    });
    await act(async () => {
      await expansion.toggle();
    });
    expect(setWindowExpansion).toHaveBeenLastCalledWith({ panelWidth: null, direction: "left" });
  });

  it("keeps the button unpressed when the display has no room and retries on click", async () => {
    setWindowExpansion.mockResolvedValue(false);
    await act(async () => {
      renderer = create(<Panel open />);
    });
    await act(async () => {
      await expansion.toggle();
    });
    expect(expansion.expanded).toBe(false);

    setWindowExpansion.mockImplementation(async ({ panelWidth }) => panelWidth !== null);
    await act(async () => {
      await expansion.toggle();
    });
    expect(expansion.expanded).toBe(true);
  });

  it("grows the window by the visible panel width and keeps the panel at that width", async () => {
    storedItems.set("test-panel-width", "800");
    vi.stubGlobal("document", {
      querySelectorAll: () => [
        { getBoundingClientRect: () => ({ width: 0 }) },
        { getBoundingClientRect: () => ({ width: 420 }) },
      ],
    });
    await act(async () => {
      renderer = create(<Panel open />);
    });
    await act(async () => {
      await expansion.toggle();
    });
    expect(setWindowExpansion).toHaveBeenCalledExactlyOnceWith({
      panelWidth: 420,
      direction: "right",
    });
    expect(storedItems.get("test-panel-width")).toBe("420");
  });

  it("keeps the saved panel width when the window cannot expand", async () => {
    storedItems.set("test-panel-width", "800");
    setWindowExpansion.mockResolvedValue(false);
    vi.stubGlobal("document", {
      querySelectorAll: () => [{ getBoundingClientRect: () => ({ width: 420 }) }],
    });
    await act(async () => {
      renderer = create(<Panel open />);
    });
    await act(async () => {
      await expansion.toggle();
    });
    expect(storedItems.get("test-panel-width")).toBe("800");
  });

  it("converts the panel width to window units at the app zoom", async () => {
    zoomFactor = 1.25;
    await act(async () => {
      renderer = create(<Panel open={false} />);
    });
    await act(async () => {
      await expansion.prepareOpen();
    });
    expect(setWindowExpansion).toHaveBeenCalledExactlyOnceWith({
      panelWidth: 675,
      direction: "right",
    });
  });

  it("restores a prepared expansion when opening the panel is cancelled", async () => {
    await act(async () => {
      renderer = create(<Panel open={false} />);
    });
    await act(async () => {
      await expansion.prepareOpen();
    });
    await act(async () => {
      await expansion.cancelPreparedOpen();
    });
    expect(setWindowExpansion).toHaveBeenLastCalledWith({ panelWidth: null, direction: "right" });
    expect(expansion.expanded).toBe(false);
  });
});
