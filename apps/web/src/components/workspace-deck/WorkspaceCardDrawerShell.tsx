import { ChevronDownIcon } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  nextWorkspaceCardDrawerHeightFromPointer,
  parsePersistedWorkspaceCardDrawerHeight,
  resolveWorkspaceCardDrawerHeight,
  resolveWorkspaceCardDrawerHeightBounds,
} from "./workspaceCardDeck.logic";

export interface WorkspaceCardDrawerTab<TabId extends string> {
  readonly id: TabId;
  readonly label: string;
}

export interface WorkspaceCardDrawerClassNames {
  readonly collapse?: string;
  readonly content?: string;
  readonly header?: string;
  readonly headerActions?: string;
  readonly resizeHandle?: string;
  readonly root?: string;
  readonly tabs?: string;
}

interface WorkspaceCardDrawerShellCommonProps<TabId extends string> {
  readonly open: boolean;
  readonly activeTab: TabId;
  readonly ariaLabel: string;
  readonly children: ReactNode;
  readonly collapseLabel: string;
  readonly tabs: readonly WorkspaceCardDrawerTab<TabId>[];
  readonly title: string;
  readonly availableHeight?: number;
  readonly className?: string;
  readonly classNames?: WorkspaceCardDrawerClassNames;
  readonly dataAttributes?: Readonly<Record<`data-${string}`, string>>;
  readonly headerActions?: ReactNode;
  readonly subtitle?: string | null;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly showTabs?: boolean;
  readonly onActiveTabChange: (tab: TabId) => void;
  readonly onEscapeBeforeCollapse?: () => boolean;
  readonly onHeightChange?: (height: number) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onVisibilityChange?: (visible: boolean) => void;
}

interface ResizableWorkspaceCardDrawerShellProps {
  readonly sizingMode?: "resizable";
  readonly resizeLabel: string;
  readonly storageKey: string;
}

interface ContentWorkspaceCardDrawerShellProps {
  readonly sizingMode: "content";
  readonly resizeLabel?: never;
  readonly storageKey?: never;
}

export type WorkspaceCardDrawerShellProps<TabId extends string> =
  WorkspaceCardDrawerShellCommonProps<TabId> &
    (ResizableWorkspaceCardDrawerShellProps | ContentWorkspaceCardDrawerShellProps);

interface DrawerResizeState {
  readonly pointerId: number;
  readonly startHeight: number;
  readonly startY: number;
  readonly target: HTMLElement;
  readonly previousBodyCursor: string;
  readonly previousBodyUserSelect: string;
  pendingHeight: number;
  frame: number | null;
}

const HEIGHT_KEYBOARD_STEP = 24;

function readStoredHeight(storageKey: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    return parsePersistedWorkspaceCardDrawerHeight(window.localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

function writeStoredHeight(storageKey: string, height: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, String(height));
  } catch {
    // Resizing remains available when storage is unavailable or full.
  }
}

function useAvailableDrawerHeight(providedHeight?: number): number {
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  useEffect(() => {
    if (providedHeight !== undefined || typeof window === "undefined") return;
    let frame = 0;
    const updateHeight = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setViewportHeight(window.innerHeight);
      });
    };
    window.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [providedHeight]);
  return providedHeight ?? viewportHeight;
}

export function WorkspaceCardDrawerShell<TabId extends string>(
  props: WorkspaceCardDrawerShellProps<TabId>,
) {
  const translate = useInterfaceTranslator().message;
  const accessibilityId = useId();
  const availableHeight = useAvailableDrawerHeight(props.availableHeight);
  const sizingMode = props.sizingMode === "content" ? "content" : "resizable";
  const storageKey = props.sizingMode === "content" ? null : props.storageKey;
  const [height, setHeight] = useState(() => {
    if (storageKey === null) {
      return resolveWorkspaceCardDrawerHeight({ availableHeight });
    }
    const storedHeight = readStoredHeight(storageKey);
    return resolveWorkspaceCardDrawerHeight(
      storedHeight === null
        ? { availableHeight }
        : { availableHeight, requestedHeight: storedHeight },
    );
  });
  const drawerRef = useRef<HTMLElement | null>(null);
  const returnFocusTargetRef = useRef<HTMLElement | null>(null);
  const resizeStateRef = useRef<DrawerResizeState | null>(null);
  const visibleRef = useRef(props.open);
  const previousOpenRef = useRef(props.open);
  const bounds = resolveWorkspaceCardDrawerHeightBounds(availableHeight);
  const clampedHeight = resolveWorkspaceCardDrawerHeight({
    availableHeight,
    requestedHeight: height,
  });
  const notifyHeightChange = useEffectEvent((nextHeight: number) => {
    props.onHeightChange?.(nextHeight);
  });
  const notifyVisibilityChange = useEffectEvent((visible: boolean) => {
    props.onVisibilityChange?.(visible);
  });
  const contentHeightNotificationsEnabled =
    sizingMode === "content" && props.onHeightChange !== undefined;

  useEffect(() => {
    if (sizingMode !== "resizable") return;
    setHeight((currentHeight) =>
      resolveWorkspaceCardDrawerHeight({ availableHeight, requestedHeight: currentHeight }),
    );
  }, [availableHeight, sizingMode]);
  useEffect(() => {
    if (sizingMode === "resizable") notifyHeightChange(clampedHeight);
  }, [clampedHeight, sizingMode]);
  useLayoutEffect(() => {
    if (!contentHeightNotificationsEnabled || !props.open) return;
    const drawer = drawerRef.current;
    if (!drawer) return;

    let previousHeight: number | null = null;
    const reportHeight = () => {
      const nextHeight = drawer.getBoundingClientRect().height;
      if (!Number.isFinite(nextHeight) || nextHeight === previousHeight) return;
      previousHeight = nextHeight;
      notifyHeightChange(nextHeight);
    };

    reportHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reportHeight);
    observer.observe(drawer, { box: "border-box" });
    return () => observer.disconnect();
  }, [contentHeightNotificationsEnabled, props.open]);
  useEffect(() => {
    visibleRef.current = props.open;
    notifyVisibilityChange(props.open);
  }, [props.open]);
  useEffect(
    () => () => {
      if (visibleRef.current) notifyVisibilityChange(false);
    },
    [],
  );

  const restoreTriggerFocus = useCallback(() => {
    const target = props.returnFocusRef?.current ?? returnFocusTargetRef.current;
    if (!target?.isConnected || typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      try {
        target.focus({ preventScroll: true });
      } catch {
        // The trigger can disappear during scope navigation.
      }
    });
  }, [props.returnFocusRef]);
  const closeDrawer = useCallback(() => props.onOpenChange(false), [props.onOpenChange]);

  useLayoutEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = props.open;
    if (wasOpen && !props.open) restoreTriggerFocus();
  }, [props.open, restoreTriggerFocus]);

  useEffect(() => {
    if (!props.open || typeof document === "undefined") return;
    const activeElement = document.activeElement;
    returnFocusTargetRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      drawerRef.current
        ?.querySelector<HTMLElement>("[data-workspace-card-drawer-initial-focus]")
        ?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (props.onEscapeBeforeCollapse?.()) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      closeDrawer();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDrawer, props.onEscapeBeforeCollapse, props.open]);

  const releaseResize = useCallback((pointerId: number) => {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== pointerId) return null;
    if (state.frame !== null) window.cancelAnimationFrame(state.frame);
    try {
      if (state.target.hasPointerCapture(pointerId)) state.target.releasePointerCapture(pointerId);
    } catch {
      // Native cancellation may release capture first.
    }
    document.body.style.cursor = state.previousBodyCursor;
    document.body.style.userSelect = state.previousBodyUserSelect;
    resizeStateRef.current = null;
    return state;
  }, []);
  useEffect(
    () => () => {
      const state = resizeStateRef.current;
      if (state) releaseResize(state.pointerId);
    },
    [releaseResize],
  );

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (sizingMode !== "resizable") return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
      resizeStateRef.current = {
        pointerId: event.pointerId,
        startHeight: clampedHeight,
        startY: event.clientY,
        target: event.currentTarget,
        pendingHeight: clampedHeight,
        frame: null,
        previousBodyCursor: document.body.style.cursor,
        previousBodyUserSelect: document.body.style.userSelect,
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [clampedHeight, sizingMode],
  );
  const onResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = resizeStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      state.pendingHeight = nextWorkspaceCardDrawerHeightFromPointer({
        availableHeight,
        currentY: event.clientY,
        startHeight: state.startHeight,
        startY: state.startY,
      });
      if (state.frame !== null) return;
      state.frame = window.requestAnimationFrame(() => {
        const activeState = resizeStateRef.current;
        if (!activeState) return;
        activeState.frame = null;
        setHeight(activeState.pendingHeight);
      });
    },
    [availableHeight],
  );
  const onResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = releaseResize(event.pointerId);
      if (!state) return;
      const finalHeight = resolveWorkspaceCardDrawerHeight({
        availableHeight,
        requestedHeight: state.pendingHeight,
      });
      setHeight(finalHeight);
      if (storageKey !== null) writeStoredHeight(storageKey, finalHeight);
    },
    [availableHeight, releaseResize, storageKey],
  );
  const onResizePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = releaseResize(event.pointerId);
      if (state) setHeight(state.startHeight);
    },
    [releaseResize],
  );
  const setKeyboardHeight = useCallback(
    (nextHeight: number) => {
      const resolvedHeight = resolveWorkspaceCardDrawerHeight({
        availableHeight,
        requestedHeight: nextHeight,
      });
      setHeight(resolvedHeight);
      if (storageKey !== null) writeStoredHeight(storageKey, resolvedHeight);
    },
    [availableHeight, storageKey],
  );
  const onResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const nextHeight = (() => {
        switch (event.key) {
          case "ArrowUp":
            return clampedHeight + HEIGHT_KEYBOARD_STEP;
          case "ArrowDown":
            return clampedHeight - HEIGHT_KEYBOARD_STEP;
          case "PageUp":
            return clampedHeight + HEIGHT_KEYBOARD_STEP * 4;
          case "PageDown":
            return clampedHeight - HEIGHT_KEYBOARD_STEP * 4;
          case "Home":
            return bounds.min;
          case "End":
            return bounds.max;
          default:
            return null;
        }
      })();
      if (nextHeight === null) return;
      event.preventDefault();
      setKeyboardHeight(nextHeight);
    },
    [bounds.max, bounds.min, clampedHeight, setKeyboardHeight],
  );

  if (!props.open) return null;
  const showTabs = props.showTabs !== false && props.tabs.length > 0;
  const style =
    sizingMode === "content"
      ? ({ "--workspace-card-drawer-max-height": `${bounds.max}px` } as CSSProperties)
      : ({
          "--workspace-card-drawer-height": `${clampedHeight}px`,
        } as CSSProperties);
  return (
    <section
      ref={drawerRef}
      className={cn("workspace-card-drawer", props.classNames?.root, props.className)}
      style={style}
      aria-label={props.ariaLabel}
      data-workspace-card-drawer="true"
      data-workspace-card-drawer-sizing={sizingMode}
      {...props.dataAttributes}
    >
      {props.sizingMode === "content" ? null : (
        <div
          className={cn("workspace-card-drawer__resize-handle", props.classNames?.resizeHandle)}
          role="separator"
          aria-label={props.resizeLabel}
          aria-orientation="horizontal"
          aria-valuemin={bounds.min}
          aria-valuemax={bounds.max}
          aria-valuenow={clampedHeight}
          tabIndex={0}
          onKeyDown={onResizeKeyDown}
          onPointerCancel={onResizePointerCancel}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        >
          <span aria-hidden />
        </div>
      )}
      <header className={cn("workspace-card-drawer__header", props.classNames?.header)}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-medium text-sm">{props.title}</h2>
            {props.subtitle ? (
              <span className="truncate text-muted-foreground text-xs">{props.subtitle}</span>
            ) : null}
          </div>
        </div>
        <div
          className={cn("workspace-card-drawer__header-actions", props.classNames?.headerActions)}
        >
          {props.headerActions}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={cn("workspace-card-drawer__collapse", props.classNames?.collapse)}
                  aria-label={props.collapseLabel}
                  data-workspace-card-drawer-initial-focus
                  data-git-workbench-initial-focus
                  onClick={closeDrawer}
                />
              }
            >
              <ChevronDownIcon aria-hidden />
            </TooltipTrigger>
            <TooltipPopup side="top">{props.collapseLabel}</TooltipPopup>
          </Tooltip>
        </div>
      </header>
      {showTabs ? (
        <nav
          className={cn("workspace-card-drawer__tabs", props.classNames?.tabs)}
          role="tablist"
          aria-label={translate("sidebar.workspaceDeck.views", { title: props.title })}
        >
          {props.tabs.map((tab) => {
            const selected = tab.id === props.activeTab;
            return (
              <button
                key={tab.id}
                id={`${accessibilityId}-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-controls={`${accessibilityId}-panel`}
                aria-selected={selected}
                data-active={selected ? "true" : undefined}
                onClick={() => props.onActiveTabChange(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      ) : null}
      <div
        className={cn("workspace-card-drawer__content", props.classNames?.content)}
        id={showTabs ? `${accessibilityId}-panel` : undefined}
        role={showTabs ? "tabpanel" : undefined}
        aria-labelledby={showTabs ? `${accessibilityId}-tab-${props.activeTab}` : undefined}
      >
        {props.children}
      </div>
    </section>
  );
}
