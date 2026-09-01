import { InfoIcon, Undo2Icon } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  createContext,
  type ComponentPropsWithoutRef,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { cn } from "../../lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { WorkspacePageContainer, type WorkspacePageWidth } from "../WorkspacePageContainer";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface SettingsSearchTargetContextValue {
  readonly targetId: string | null;
  readonly onTargetHandled: () => void;
}

const noop = () => undefined;
const SettingsSearchTargetContext = createContext<SettingsSearchTargetContextValue>({
  targetId: null,
  onTargetHandled: noop,
});

export function SettingsSearchTargetProvider({
  targetId,
  onTargetHandled = noop,
  children,
}: {
  targetId: string | null;
  onTargetHandled?: () => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ targetId, onTargetHandled }), [onTargetHandled, targetId]);
  return <SettingsSearchTargetContext value={value}>{children}</SettingsSearchTargetContext>;
}

function scrollAndFocusSettingsTarget(target: HTMLElement): void {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollTarget =
    target.tagName === "SECTION" && target.firstElementChild
      ? (target.firstElementChild as HTMLElement)
      : target;

  scrollTarget.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "center",
  });
  target.focus({ preventScroll: true });
  target.classList.remove("settings-search-target-pulse");
  if (prefersReducedMotion) return;
  void target.offsetWidth;
  target.classList.add("settings-search-target-pulse");
  // The class also suppresses the focus outline (the pulse is the destination
  // indicator), so drop it once the element is no longer the destination.
  target.addEventListener("blur", () => target.classList.remove("settings-search-target-pulse"), {
    once: true,
  });
}

/** The row id a settings-search jump is currently trying to reach, if any. */
export function useSettingsSearchTargetId(): string | null {
  return useContext(SettingsSearchTargetContext).targetId;
}

function useSettingsSearchTarget<T extends HTMLElement>(id: string | undefined) {
  const { targetId, onTargetHandled } = useContext(SettingsSearchTargetContext);
  const isSearchTarget = id !== undefined && id === targetId;
  const targetRef = useCallback(
    (target: T | null) => {
      if (target && isSearchTarget) {
        scrollAndFocusSettingsTarget(target);
        onTargetHandled();
      }
    },
    [isSearchTarget, onTargetHandled],
  );

  return targetRef;
}

/** Info affordance explaining how a setting interacts with the shared background policy. */
export function PolicyTooltip({ children }: { readonly children: string }) {
  const translate = useInterfaceTranslator().message;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={translate("settings.common.backgroundPolicyDetails")}
          >
            <InfoIcon className="size-3.5" />
          </Button>
        }
      />
      <TooltipPopup side="top" className="max-w-72">
        {children}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Re-render every `intervalMs`; return a stable timestamp snapshot for render-time relative labels. */
export function useRelativeTimeTick(intervalMs = 1_000) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}

export function SettingsSection({
  title,
  icon,
  headerAction,
  children,
  className,
  ...sectionProps
}: ComponentPropsWithoutRef<"section"> & {
  title: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLElement>(sectionProps.id);

  return (
    <section
      {...sectionProps}
      ref={targetRef}
      tabIndex={sectionProps.id ? -1 : sectionProps.tabIndex}
      className={cn("space-y-3", className)}
    >
      <div className="flex min-h-8 items-center justify-between gap-4 px-3 sm:px-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.025em] text-foreground">
          {icon}
          {title}
        </h2>
        <div className="flex min-h-7 min-w-7 items-center justify-end">{headerAction}</div>
      </div>
      <div className="relative space-y-1 overflow-visible text-foreground">{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  visual,
  children,
  className,
  ...rowProps
}: Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  visual?: ReactNode;
  children?: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLDivElement>(rowProps.id);
  const hasVisual = visual !== undefined && visual !== null;

  return (
    <div
      {...rowProps}
      ref={targetRef}
      tabIndex={rowProps.id ? -1 : rowProps.tabIndex}
      className={cn(
        "rounded-xl px-3 sm:px-4",
        children ? "pt-3 pb-1" : "py-3",
        hasVisual && "border border-border/60 bg-card/35 shadow-[0_16px_48px_-42px_rgb(0_0_0/85%)]",
        className,
      )}
    >
      <div
        className={cn(
          "grid gap-3",
          hasVisual
            ? "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center md:grid-cols-[minmax(12rem,1fr)_minmax(15rem,20rem)_auto] md:gap-5"
            : "sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] sm:items-center sm:gap-8",
        )}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium tracking-[-0.005em] text-foreground">{title}</h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          {description ? (
            <p className="max-w-xl text-[13px] leading-[1.45] text-muted-foreground/80">
              {description}
            </p>
          ) : null}
          {status ? <div className="pt-0.5 text-xs text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div
            className={cn(
              "flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end",
              hasVisual && "sm:col-start-2 sm:row-start-1 md:col-start-3",
            )}
          >
            {control}
          </div>
        ) : null}
        {hasVisual ? (
          <div
            aria-hidden="true"
            className="overflow-hidden rounded-lg border border-border/60 bg-background/65 sm:col-span-2 md:col-span-1 md:col-start-2 md:row-start-1"
            data-settings-row-visual
          >
            {visual}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingResetButton({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={translate("settings.common.resetAria", { label })}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Undo2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">{translate("settings.common.reset")}</TooltipPopup>
    </Tooltip>
  );
}

export function SettingsPageContainer({
  children,
  className,
  viewportClassName,
  width = "readable",
}: {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  width?: WorkspacePageWidth;
}) {
  const navigate = useNavigate();
  const hash = useLocation({ select: (location) => location.hash });
  const targetId = hash.replace(/^#/, "") || null;
  const clearTargetHash = useCallback(() => {
    void navigate({ hash: "", replace: true, resetScroll: false, hashScrollIntoView: false });
  }, [navigate]);

  return (
    <SettingsSearchTargetProvider targetId={targetId} onTargetHandled={clearTargetHash}>
      <div
        className={cn(
          "topbar-scroll-fade scrollbar-gutter-both flex-1 overflow-y-auto [--topbar-scroll-fade-height:1.5rem] sm:[--topbar-scroll-fade-height:1.5rem]",
          viewportClassName,
        )}
        data-settings-page-scroll
      >
        <WorkspacePageContainer width={width} className={cn("gap-12", className)}>
          {children}
        </WorkspacePageContainer>
      </div>
    </SettingsSearchTargetProvider>
  );
}

export function scrollToSettingsTarget(targetId: string): boolean {
  const target = document.getElementById(targetId);
  if (!target) return false;
  scrollAndFocusSettingsTarget(target);
  return true;
}
