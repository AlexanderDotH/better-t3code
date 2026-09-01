import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { ComposerBanner, type ComposerBannerVariant } from "./ComposerBanner";

// Match the duration-220 exit transition before removing a dismissed notice.
const DISMISS_TRANSITION_MS = 220;

export interface ComposerBannerStackItem {
  readonly id: string;
  readonly variant: ComposerBannerVariant;
  readonly priority?: "urgent" | "activity" | "notice";
  readonly urgent?: boolean;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

export type ComposerBannerStackContent = Pick<
  ComposerBannerStackItem,
  "id" | "variant" | "priority" | "className"
> & { readonly content: ReactNode };

type ComposerBannerStackEntry = ComposerBannerStackItem | ComposerBannerStackContent;

function bannerPriority(item: ComposerBannerStackEntry) {
  if (item.priority === "activity") {
    return 0;
  }
  if (
    item.priority === "urgent" ||
    ("urgent" in item && item.urgent) ||
    item.variant === "error" ||
    item.variant === "warning"
  ) {
    return 1;
  }
  return 2;
}

interface ComposerBannerStackProps {
  readonly className?: string;
  readonly items: ReadonlyArray<ComposerBannerStackEntry>;
  readonly placement?: "attached" | "floating";
}

export function ComposerBannerStack({
  className,
  items,
  placement = "attached",
}: ComposerBannerStackProps) {
  const translate = useInterfaceTranslator().message;
  const [stackExpanded, setStackExpanded] = useState(false);
  const noticesRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLButtonElement>(null);
  const expandedItemsId = useId();
  const [requestedExitingItemId, setExitingItemId] = useState<string | null>(null);
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitingItemId =
    requestedExitingItemId !== null && items.some((item) => item.id === requestedExitingItemId)
      ? requestedExitingItemId
      : null;

  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (items.length < 2) setStackExpanded(false);
  }, [items.length]);

  if (items.length === 0) {
    return null;
  }

  // Activity stays attached. Urgency and severity only order the notices behind it.
  const orderedItems = items.toSorted((a, b) => bannerPriority(a) - bannerPriority(b));
  const frontItem = orderedItems[0];
  if (!frontItem) {
    return null;
  }
  const stackedItems = orderedItems.slice(1);
  const hasStack = stackedItems.length > 0;
  const showCollapsedStackCap = hasStack && exitingItemId !== frontItem.id;
  const firstStackedItem = stackedItems[0];

  const requestDismiss = (item: ComposerBannerStackEntry) => {
    if (!("onDismiss" in item) || !item.onDismiss || exitingItemId) {
      return;
    }
    setExitingItemId(item.id);
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
    }
    dismissTimeoutRef.current = setTimeout(() => {
      dismissTimeoutRef.current = null;
      item.onDismiss?.();
    }, DISMISS_TRANSITION_MS);
  };

  if (placement === "floating") {
    return (
      <ComposerBanner.Attachment
        className={className}
        data-composer-banner-stack-grouped="true"
        data-composer-banner-drawer="true"
        data-chat-composer-collapsed-controls="true"
      >
        <div className="divide-y divide-border/60">
          {orderedItems.map((item) => (
            <div
              key={item.id}
              className={cn(
                "transition-[translate,opacity] duration-220 ease-in",
                exitingItemId === item.id
                  ? "pointer-events-none -translate-y-2 opacity-0"
                  : "opacity-100",
              )}
            >
              <ComposerBannerStackAlert
                item={item}
                placement="grouped"
                exiting={exitingItemId === item.id}
                onDismissRequest={() => requestDismiss(item)}
              />
            </div>
          ))}
        </div>
      </ComposerBanner.Attachment>
    );
  }

  return (
    <ComposerBanner.Attachment
      className={className}
      data-composer-banner-drawer="true"
      data-chat-composer-collapsed-controls="true"
    >
      <div className={cn("relative flex flex-col-reverse", hasStack && stackExpanded && "z-50")}>
        <div
          className={cn(
            "relative z-10 transition-[translate,opacity] duration-220 ease-in",
            exitingItemId === frontItem.id
              ? "pointer-events-none translate-y-16 opacity-0"
              : "opacity-100",
          )}
          onPointerDownCapture={() => {
            setStackExpanded(false);
            const activeElement = document.activeElement;
            if (
              activeElement instanceof HTMLElement &&
              noticesRef.current?.contains(activeElement)
            ) {
              activeElement.blur();
            }
          }}
        >
          <ComposerBannerStackAlert
            item={frontItem}
            placement={placement}
            exiting={exitingItemId === frontItem.id}
            onDismissRequest={() => requestDismiss(frontItem)}
          />
        </div>
        {hasStack ? (
          <div
            ref={noticesRef}
            className="relative z-20"
            onPointerEnter={(event) => {
              if (event.pointerType !== "touch") setStackExpanded(true);
            }}
            onPointerLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) setStackExpanded(false);
            }}
            onFocusCapture={() => setStackExpanded(true)}
            onBlurCapture={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !event.currentTarget.matches(":hover")
              ) {
                setStackExpanded(false);
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              peekRef.current?.focus({ preventScroll: true });
              setStackExpanded(false);
            }}
          >
            {showCollapsedStackCap && firstStackedItem ? (
              <ComposerBanner.Peek
                ref={peekRef}
                variant={firstStackedItem.variant}
                aria-label={translate("chat.composer.showOtherNotices")}
                aria-expanded={stackExpanded}
                aria-controls={expandedItemsId}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  setStackExpanded(true);
                }}
                className={cn(stackExpanded && "opacity-0")}
              />
            ) : null}
            <div
              id={expandedItemsId}
              data-composer-banner-stack-expanded-items="true"
              className={cn(
                "grid transition-[grid-template-rows] duration-150 ease-out",
                stackExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div
                  className={cn(
                    "transform-gpu space-y-2 pb-2 transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform]",
                    stackExpanded
                      ? "pointer-events-auto visible translate-y-0 opacity-100"
                      : "pointer-events-none invisible translate-y-1 opacity-0",
                  )}
                >
                  {stackedItems.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "transition-[translate,opacity] duration-220 ease-in",
                        exitingItemId === item.id
                          ? "pointer-events-none translate-y-28 opacity-0"
                          : "opacity-100",
                      )}
                    >
                      <ComposerBannerStackAlert
                        item={item}
                        placement="floating"
                        exiting={exitingItemId === item.id}
                        onDismissRequest={() => requestDismiss(item)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ComposerBanner.Attachment>
  );
}

function ComposerBannerStackAlert({
  item,
  placement,
  exiting,
  onDismissRequest,
}: {
  readonly item: ComposerBannerStackEntry;
  readonly placement: "attached" | "floating" | "grouped";
  readonly exiting: boolean;
  readonly onDismissRequest: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  if ("content" in item) {
    return (
      <ComposerBanner.Root placement={placement} variant={item.variant} className={item.className}>
        {item.content}
      </ComposerBanner.Root>
    );
  }

  return (
    <ComposerBanner.Root
      role="alert"
      placement={placement}
      variant={item.variant}
      className={item.className}
    >
      <ComposerBanner.Row layout="wrap-actions">
        <ComposerBanner.Icon>{item.icon}</ComposerBanner.Icon>
        <ComposerBanner.Content className="font-medium">{item.title}</ComposerBanner.Content>
        {item.actions || item.onDismiss ? (
          <ComposerBanner.Actions>
            {item.actions}
            {item.onDismiss ? (
              <ComposerBanner.Dismiss
                aria-label={item.dismissLabel ?? translate("ui.notification.dismiss")}
                disabled={exiting}
                onClick={onDismissRequest}
              />
            ) : null}
          </ComposerBanner.Actions>
        ) : null}
      </ComposerBanner.Row>
      {item.description || item.children ? (
        <ComposerBanner.Children>
          {item.description ? (
            <ComposerBanner.Row>
              <ComposerBanner.Icon />
              <ComposerBanner.Content className="text-muted-foreground">
                {item.description}
              </ComposerBanner.Content>
            </ComposerBanner.Row>
          ) : null}
          {item.children}
        </ComposerBanner.Children>
      ) : null}
    </ComposerBanner.Root>
  );
}
