import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

const DISMISS_TRANSITION_MS = 220;
const itemExitStyle = {
  opacity: 0,
  transform: "translate3d(0, 4rem, 0)",
} satisfies CSSProperties;
const restingStyle = {
  opacity: 1,
  transform: "none",
} satisfies CSSProperties;
const exitTransitionStyle = {
  transition: `transform ${DISMISS_TRANSITION_MS}ms ease-in, opacity ${DISMISS_TRANSITION_MS}ms ease-in`,
} satisfies CSSProperties;

export interface ComposerBannerStackItem {
  readonly id: string;
  readonly variant: "default" | "error" | "info" | "success" | "warning";
  // Ordering hint for stack assemblers: front this banner even though its
  // variant is calm (e.g. live update progress). The stack itself ignores it.
  readonly urgent?: boolean;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly actionClassName?: string;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

interface ComposerBannerStackProps {
  readonly className?: string;
  readonly items: ReadonlyArray<ComposerBannerStackItem>;
}

export function ComposerBannerStack({ className, items }: ComposerBannerStackProps) {
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

  if (items.length === 0) {
    return null;
  }

  const requestDismiss = (item: ComposerBannerStackItem) => {
    if (!item.onDismiss || exitingItemId) {
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

  return (
    <div
      className={cn(
        "chat-composer-banner-list chat-composer-drawer-slot chat-composer-drawer-floating flex flex-col-reverse gap-2",
        className,
      )}
      data-composer-banner-drawer="true"
      data-composer-banner-list="true"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn("relative", exitingItemId === item.id ? "pointer-events-none" : null)}
          style={{
            ...exitTransitionStyle,
            ...(exitingItemId === item.id ? itemExitStyle : restingStyle),
          }}
        >
          <ComposerBannerStackAlert
            item={item}
            exiting={exitingItemId === item.id}
            onDismissRequest={() => requestDismiss(item)}
          />
        </div>
      ))}
    </div>
  );
}

function ComposerBannerStackAlert({
  item,
  exiting,
  onDismissRequest,
}: {
  readonly item: ComposerBannerStackItem;
  readonly exiting: boolean;
  readonly onDismissRequest: () => void;
}) {
  const dismissOnly = item.onDismiss && !item.actions;

  return (
    <Alert
      variant={item.variant}
      controlAlignment={dismissOnly ? "first-line" : "center"}
      className={cn("alert-glass rounded-full px-3 py-2 text-xs sm:px-4", item.className)}
      data-composer-banner-pill="true"
      data-variant={item.variant}
    >
      {item.icon}
      <AlertTitle>{item.title}</AlertTitle>
      {item.description ? <AlertDescription>{item.description}</AlertDescription> : null}
      {item.actions || item.onDismiss ? (
        <AlertAction
          className={cn(
            item.actionClassName,
            dismissOnly
              ? "max-sm:col-start-3 max-sm:row-start-1 max-sm:mt-0 max-sm:self-start"
              : undefined,
          )}
        >
          {item.actions}
          {item.onDismiss ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={item.dismissLabel ?? "Dismiss warning"}
              disabled={exiting}
              onClick={onDismissRequest}
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
}
