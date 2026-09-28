import * as Schema from "effect/Schema";
import { useCallback, useSyncExternalStore } from "react";

import { isMacElectron } from "../env";
import { PREVIEW_PANEL_MIN_WIDTH } from "../rightPanelLayout";
import { getLocalStorageItem } from "./useLocalStorage";
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

function panelWidthForExpansion(storageKey: string, defaultWidth: number): number {
  try {
    return Math.max(
      PREVIEW_PANEL_MIN_WIDTH,
      getLocalStorageItem(storageKey, Schema.Finite) ?? defaultWidth,
    );
  } catch {
    return defaultWidth;
  }
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

  const request = useCallback(
    async (panelWidth: number | null, requestDirection: Direction) => {
      if (!expandWindow || store.getSnapshot().preparing) return false;
      const previous = store.getSnapshot();
      store.set({ ...previous, preparing: true });
      try {
        const applied = await expandWindow({ panelWidth, direction: requestDirection });
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
    },
    [expandWindow, store],
  );

  const prepareOpen = useCallback(
    () => request(panelWidthForExpansion(panelWidthStorageKey, defaultPanelWidth), direction),
    [defaultPanelWidth, direction, panelWidthStorageKey, request],
  );
  const toggle = useCallback(
    () =>
      expanded
        ? request(null, expandedDirection ?? direction)
        : request(panelWidthForExpansion(panelWidthStorageKey, defaultPanelWidth), direction),
    [defaultPanelWidth, direction, expanded, expandedDirection, panelWidthStorageKey, request],
  );
  const cancelPreparedOpen = useCallback(() => {
    const current = store.getSnapshot();
    if (current.expanded && current.direction) {
      void request(null, current.direction);
    }
  }, [request, store]);

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
