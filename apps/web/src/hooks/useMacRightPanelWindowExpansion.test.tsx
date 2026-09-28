import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
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
  const items = new Map<string, string>();
  const browserWindow = Object.assign(new EventTarget(), {
    desktopBridge: { setRightPanelWindowExpansion: setWindowExpansion },
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", browserWindow);
});

afterEach(async () => {
  await act(() => renderer?.unmount());
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

    await act(async () => renderer.update(<Panel open />));
    expect(setWindowExpansion).toHaveBeenCalledTimes(1);
    await act(async () => {
      await expansion.toggle();
    });
    expect(expansion.expanded).toBe(false);
    expect(setWindowExpansion).toHaveBeenLastCalledWith({ panelWidth: null, direction: "right" });
  });

  it("does not change window size when the normal sidebar button opens or closes the panel", async () => {
    await act(async () => {
      renderer = create(<Panel open={false} />);
    });
    await act(async () => renderer.update(<Panel open />));
    expect(setWindowExpansion).not.toHaveBeenCalled();

    await act(async () => {
      await expansion.toggle();
    });
    expect(expansion.expanded).toBe(true);
    await act(async () => renderer.update(<Panel open={false} />));
    expect(expansion.expanded).toBe(true);
    await act(async () => renderer.update(<Panel open />));
    expect(setWindowExpansion).toHaveBeenCalledTimes(1);
  });

  it("keeps the button state across a chat or route remount", async () => {
    await act(async () => {
      renderer = create(<Panel open />);
    });
    await act(async () => {
      await expansion.toggle();
    });
    await act(async () => renderer.unmount());
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
    await act(async () => renderer.update(<Panel open />));
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

  it("restores a prepared expansion when opening the panel is cancelled", async () => {
    await act(async () => {
      renderer = create(<Panel open={false} />);
    });
    await act(async () => {
      await expansion.prepareOpen();
    });
    await act(async () => expansion.cancelPreparedOpen());
    expect(setWindowExpansion).toHaveBeenLastCalledWith({ panelWidth: null, direction: "right" });
    expect(expansion.expanded).toBe(false);
  });
});
