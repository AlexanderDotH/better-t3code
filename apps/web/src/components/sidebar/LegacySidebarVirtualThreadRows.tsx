import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
  type RefCallback,
} from "react";

export const LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_THRESHOLD = 24;
export const LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_CONTENT_HEIGHT_PX = 28;
export const LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX =
  LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_CONTENT_HEIGHT_PX + 2;
export const LEGACY_SIDEBAR_VIRTUAL_THREAD_OVERSCAN_PX =
  LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_STRIDE_PX * 4;

const SCROLL_AREA_VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]';
const EMPTY_FORCED_KEYS: readonly string[] = [];

type ThreadRowObserver = Pick<IntersectionObserver, "disconnect" | "observe" | "unobserve">;

export type LegacySidebarThreadRowObserverFactory = (
  callback: IntersectionObserverCallback,
  options: IntersectionObserverInit,
) => ThreadRowObserver;

interface LegacySidebarVirtualThreadRowsMode {
  readonly isVirtualized: boolean;
  readonly shouldAnimateThreadList: boolean;
}

export function resolveLegacySidebarVirtualThreadRowsMode(
  logicalRowCount: number,
  observerAvailable: boolean,
): LegacySidebarVirtualThreadRowsMode {
  const isVirtualized =
    observerAvailable && logicalRowCount > LEGACY_SIDEBAR_VIRTUAL_THREAD_ROW_THRESHOLD;
  return {
    isVirtualized,
    shouldAnimateThreadList: !isVirtualized,
  };
}

interface LegacySidebarVirtualThreadRowHydration {
  readonly isVirtualized: boolean;
  readonly rowIndex: number;
  readonly previewRowCount: number;
  readonly isForced: boolean;
  readonly isIntersecting: boolean;
}

export function shouldHydrateLegacySidebarVirtualThreadRow(
  state: LegacySidebarVirtualThreadRowHydration,
): boolean {
  if (!state.isVirtualized || state.isForced || state.isIntersecting) {
    return true;
  }
  return state.rowIndex >= 0 && state.rowIndex < Math.max(0, Math.floor(state.previewRowCount));
}

interface LegacySidebarVirtualThreadRowObserverOptions {
  readonly createObserver: LegacySidebarThreadRowObserverFactory | null;
  readonly onHydrationChange: () => void;
}

export interface LegacySidebarVirtualThreadRowObserver {
  readonly observerAvailable: boolean;
  readonly containerRef: RefCallback<HTMLElement>;
  readonly getSlotRef: (key: string) => RefCallback<HTMLElement>;
  readonly isIntersecting: (key: string) => boolean;
  readonly retainKeys: (keys: readonly string[]) => void;
  readonly setEnabled: (enabled: boolean) => void;
}

export function createLegacySidebarVirtualThreadRowObserver(
  options: LegacySidebarVirtualThreadRowObserverOptions,
): LegacySidebarVirtualThreadRowObserver {
  const slotNodes = new Map<string, HTMLElement>();
  const keysByNode = new Map<Element, string>();
  const slotRefs = new Map<string, RefCallback<HTMLElement>>();
  const intersectingKeys = new Set<string>();
  let container: HTMLElement | null = null;
  let observer: ThreadRowObserver | null = null;
  let observerGeneration = 0;
  let enabled = false;

  const notifyAfterIntersectionChange = (changed: boolean) => {
    if (changed) {
      options.onHydrationChange();
    }
  };

  const clearIntersections = (notify = true) => {
    const changed = intersectingKeys.size > 0;
    intersectingKeys.clear();
    if (notify) notifyAfterIntersectionChange(changed);
  };

  const disconnect = () => {
    observerGeneration += 1;
    observer?.disconnect();
    observer = null;
  };

  const handleIntersections = (
    entries: readonly IntersectionObserverEntry[],
    generation: number,
  ) => {
    if (generation !== observerGeneration) {
      return;
    }
    let changed = false;
    for (const entry of entries) {
      const key = keysByNode.get(entry.target);
      if (!key) {
        continue;
      }
      if (entry.isIntersecting) {
        if (!intersectingKeys.has(key)) {
          intersectingKeys.add(key);
          changed = true;
        }
        continue;
      }
      changed = intersectingKeys.delete(key) || changed;
    }
    notifyAfterIntersectionChange(changed);
  };

  const connect = () => {
    if (!enabled || !container || !options.createObserver || observer) {
      return;
    }
    const generation = observerGeneration + 1;
    observerGeneration = generation;
    observer = options.createObserver(
      (entries) => {
        handleIntersections(entries, generation);
      },
      {
        root: container.closest<HTMLElement>(SCROLL_AREA_VIEWPORT_SELECTOR),
        rootMargin: `${LEGACY_SIDEBAR_VIRTUAL_THREAD_OVERSCAN_PX}px 0px`,
      },
    );
    for (const node of slotNodes.values()) {
      observer.observe(node);
    }
  };

  const containerRef: RefCallback<HTMLElement> = (node) => {
    if (container === node) {
      return;
    }
    disconnect();
    clearIntersections(node !== null);
    container = node;
    connect();
  };

  const attachSlot = (key: string, node: HTMLElement | null) => {
    const previousNode = slotNodes.get(key);
    if (previousNode === node) {
      return;
    }
    if (previousNode) {
      observer?.unobserve(previousNode);
      keysByNode.delete(previousNode);
      slotNodes.delete(key);
    }
    if (!node) {
      return;
    }
    slotNodes.set(key, node);
    keysByNode.set(node, key);
    observer?.observe(node);
  };

  const getSlotRef = (key: string): RefCallback<HTMLElement> => {
    const existing = slotRefs.get(key);
    if (existing) {
      return existing;
    }
    const ref: RefCallback<HTMLElement> = (node) => {
      attachSlot(key, node);
    };
    slotRefs.set(key, ref);
    return ref;
  };

  const retainKeys = (keys: readonly string[]) => {
    const retainedKeys = new Set(keys);
    let hydrationChanged = false;
    for (const [key, node] of slotNodes) {
      if (retainedKeys.has(key)) {
        continue;
      }
      observer?.unobserve(node);
      keysByNode.delete(node);
      slotNodes.delete(key);
      hydrationChanged = intersectingKeys.delete(key) || hydrationChanged;
    }
    for (const key of slotRefs.keys()) {
      if (!retainedKeys.has(key)) slotRefs.delete(key);
    }
    notifyAfterIntersectionChange(hydrationChanged);
  };

  const setEnabled = (nextEnabled: boolean) => {
    if (enabled === nextEnabled) {
      return;
    }
    enabled = nextEnabled;
    if (enabled) {
      connect();
      return;
    }
    disconnect();
    clearIntersections(false);
  };

  return {
    observerAvailable: options.createObserver !== null,
    containerRef,
    getSlotRef,
    isIntersecting: (key) => intersectingKeys.has(key),
    retainKeys,
    setEnabled,
  };
}

function resolveObserverFactory(): LegacySidebarThreadRowObserverFactory | null {
  if (typeof IntersectionObserver === "undefined") {
    return null;
  }
  return (callback, observerOptions) => new IntersectionObserver(callback, observerOptions);
}

export interface UseLegacySidebarVirtualThreadRowsOptions {
  readonly rowKeys: readonly string[];
  readonly forcedKeys?: ReadonlySet<string> | readonly string[];
  readonly previewRowCount: number;
}

export interface LegacySidebarVirtualThreadRows {
  readonly containerRef: RefCallback<HTMLElement>;
  readonly getSlotRef: (key: string) => RefCallback<HTMLElement>;
  readonly isVirtualized: boolean;
  readonly isHydrated: (key: string) => boolean;
  readonly shouldAnimateThreadList: boolean;
}

export function useLegacySidebarVirtualThreadRows(
  options: UseLegacySidebarVirtualThreadRowsOptions,
): LegacySidebarVirtualThreadRows {
  const [, forceRender] = useReducer((version: number) => version + 1, 0);
  const [rowObserver] = useState(() =>
    createLegacySidebarVirtualThreadRowObserver({
      createObserver: resolveObserverFactory(),
      onHydrationChange: forceRender,
    }),
  );
  const forcedKeys = options.forcedKeys ?? EMPTY_FORCED_KEYS;
  const forcedKeySet = useMemo(() => new Set(forcedKeys), [forcedKeys]);
  const rowIndexByKey = useMemo(
    () => new Map(options.rowKeys.map((key, index) => [key, index] as const)),
    [options.rowKeys],
  );
  const mode = resolveLegacySidebarVirtualThreadRowsMode(
    options.rowKeys.length,
    rowObserver.observerAvailable,
  );

  useLayoutEffect(() => {
    rowObserver.retainKeys(options.rowKeys);
  }, [options.rowKeys, rowObserver]);

  useLayoutEffect(() => {
    rowObserver.setEnabled(mode.isVirtualized);
    return () => {
      rowObserver.setEnabled(false);
    };
  }, [mode.isVirtualized, rowObserver]);

  const isHydrated = useCallback(
    (key: string) =>
      shouldHydrateLegacySidebarVirtualThreadRow({
        isVirtualized: mode.isVirtualized,
        rowIndex: rowIndexByKey.get(key) ?? -1,
        previewRowCount: options.previewRowCount,
        isForced: forcedKeySet.has(key),
        isIntersecting: rowObserver.isIntersecting(key),
      }),
    [forcedKeySet, mode.isVirtualized, options.previewRowCount, rowIndexByKey, rowObserver],
  );

  return {
    containerRef: rowObserver.containerRef,
    getSlotRef: rowObserver.getSlotRef,
    isVirtualized: mode.isVirtualized,
    isHydrated,
    shouldAnimateThreadList: mode.shouldAnimateThreadList,
  };
}
