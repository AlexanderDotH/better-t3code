import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import { isMacElectron } from "../env";
import { PREVIEW_PANEL_MIN_WIDTH } from "../rightPanelLayout";
import { getLocalStorageItem, writeLocalStorageValue } from "./useLocalStorage";
import { useClientSettings } from "./useSettings";

type Direction = "left" | "right";

interface ExpansionState {
  expanded: boolean;
  preparing: boolean;
  direction: Direction | null;
}

const INITIAL_STATE: ExpansionState = { expanded: false, preparing: false, direction: null };

function createExpansionStore() {
  let state = INITIAL_STATE;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next: ExpansionState) => {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

const stores = new WeakMap<Window, ReturnType<typeof createExpansionStore>>();
const serverStore = createExpansionStore();

function getExpansionStore() {
  if (typeof window === "undefined") return serverStore;
  let store = stores.get(window);
  if (!store) {
    store = createExpansionStore();
    stores.set(window, store);
  }
  return store;
}

function savedPanelWidth(storageKey: string): number | null {
  try {
    return getLocalStorageItem(storageKey, Schema.Finite);
  } catch {
    return null;
  }
}

function panelWidthForExpansion(storageKey: string, defaultWidth: number): number {
  const saved = savedPanelWidth(storageKey);
  return saved === null ? defaultWidth : Math.max(PREVIEW_PANEL_MIN_WIDTH, saved);
}

function visibleInlinePanelWidth(): number | null {
  if (typeof document === "undefined") return null;
  for (const panel of document.querySelectorAll('[data-preview-panel-mode="inline"]')) {
    const { width } = panel.getBoundingClientRect();
    if (width > 0) return width;
  }
  return null;
}

export function useMacRightPanelWindowExpansion({
  panelWidthStorageKey,
  defaultPanelWidth,
}: {
  panelWidthStorageKey: string;
  defaultPanelWidth: number;
}) {
  const store = getExpansionStore();
  const {
    expanded,
    preparing,
    direction: expandedDirection,
  } = useSyncExternalStore(store.subscribe, store.getSnapshot, () => INITIAL_STATE);
  const sidebarPosition = useClientSettings((settings) => settings.sidebarPosition);
  const direction: Direction = sidebarPosition === "right" ? "left" : "right";
  const expandWindow = isMacElectron
    ? window.desktopBridge?.setRightPanelWindowExpansion
    : undefined;

  const request = async (panelWidth: number | null, requestDirection: Direction) => {
    if (!expandWindow || store.getSnapshot().preparing) return false;
    const previous = store.getSnapshot();
    store.set({ ...previous, preparing: true });
    try {
      // Panel widths are CSS pixels; window bounds are not scaled by the app zoom.
      const zoomFactor = window.desktopBridge?.getWindowZoomFactor() ?? 1;
      const applied = await expandWindow({
        panelWidth: panelWidth === null ? null : Math.round(panelWidth * zoomFactor),
        direction: requestDirection,
      });
      store.set({
        expanded: panelWidth !== null && applied,
        preparing: false,
        direction: panelWidth !== null && applied ? requestDirection : null,
      });
      return applied;
    } catch {
      store.set(previous);
      return false;
    }
  };

  const expandBy = async (panelWidth: number) => {
    const saved = savedPanelWidth(panelWidthStorageKey);
    // The wider window lifts the panel's width cap, so save the width before it grows.
    writeLocalStorageValue(panelWidthStorageKey, panelWidth, panelWidth, Schema.Finite);
    const applied = await request(panelWidth, direction);
    if (!applied && saved !== null) {
      writeLocalStorageValue(panelWidthStorageKey, saved, saved, Schema.Finite);
    }
    return applied;
  };

  const prepareOpen = () =>
    expandBy(panelWidthForExpansion(panelWidthStorageKey, defaultPanelWidth));
  const toggle = () =>
    expanded
      ? request(null, expandedDirection ?? direction)
      : expandBy(
          visibleInlinePanelWidth() ??
            panelWidthForExpansion(panelWidthStorageKey, defaultPanelWidth),
        );
  const cancelPreparedOpen = () => {
    const current = store.getSnapshot();
    if (current.expanded && current.direction) {
      void request(null, current.direction);
    }
  };

  return {
    available: expandWindow !== undefined,
    expanded,
    preparing,
    direction,
    toggle,
    prepareOpen,
    cancelPreparedOpen,
  };
}
