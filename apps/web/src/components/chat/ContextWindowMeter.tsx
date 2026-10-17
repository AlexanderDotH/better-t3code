import { useId, useRef, useState } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import type { ContextWindowSnapshot } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { formatContextWindowCompactionMessage } from "./ContextWindowMeter.logic";
import { Minimize2Icon } from "lucide-react";
import { composerFloatingLayerProps } from "./composerEventScope";
import { ContextWindowMeterRing, contextWindowUsageColor } from "./ContextWindowMeterRing";

type ContextWindowMeterProps = {
  usage: ContextWindowSnapshot;
  modelDisplayName?: string | null;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
};

export function ContextWindowMeter({
  usage,
  reserveSpace = false,
  ...props
}: Omit<ContextWindowMeterProps, "usage"> & {
  usage: ContextWindowSnapshot | null;
  reserveSpace?: boolean;
}) {
  if (!usage) return reserveSpace ? <ContextWindowMeterPlaceholder /> : null;
  return <ContextWindowMeterButton usage={usage} {...props} />;
}

function ContextWindowMeterButton(props: ContextWindowMeterProps) {
  const { usage, modelDisplayName, onCompact, compactDisabled, compactDisabledReason } = props;
  const maxTokens = usage.maxTokens ?? null;
  const translator = useInterfaceTranslator();
  const { message, number } = translator;
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const suppressFocusOpen = useRef(false);
  const usedPercentage =
    usage.usedPercentage === null
      ? null
      : number(usage.usedPercentage / 100, {
          style: "percent",
          maximumFractionDigits: 1,
        });
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const totalProcessedTokens = usage.totalProcessedTokens ?? null;
  const showTotalProcessed = totalProcessedTokens !== null && totalProcessedTokens > 0;
  const usageColor = contextWindowUsageColor(normalizedPercentage);
  const accessibleUsage =
    maxTokens !== null && usedPercentage !== null
      ? message("chat.contextMeter.accessibleKnown", {
          used: number(usage.usedTokens),
          limit: number(maxTokens),
          percentage: usedPercentage,
        })
      : message("chat.contextMeter.accessibleUnknown", { used: number(usage.usedTokens) });

  return (
    <Popover
      open={open}
      triggerId={triggerId}
      onOpenChange={(nextOpen) => {
        suppressFocusOpen.current = !nextOpen;
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger
        id={triggerId}
        openOnHover
        delay={150}
        closeDelay={onCompact ? 150 : 0}
        render={
          <button
            type="button"
            className="relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background pointer-coarse:size-11"
            aria-label={accessibleUsage}
            onPointerDown={() => {
              suppressFocusOpen.current = true;
            }}
            onBlur={() => {
              suppressFocusOpen.current = false;
            }}
            onFocus={() => {
              if (suppressFocusOpen.current) {
                suppressFocusOpen.current = false;
                return;
              }
              setOpen(true);
            }}
          >
            <ContextWindowMeterRing percentage={usage.usedPercentage} />
          </button>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        padding="none"
        width="sm"
        initialFocus={false}
        aria-label={message("chat.contextMeter.title")}
        className="text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2 p-(--floating-content-inset)">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">
              {message("chat.contextMeter.title")}
            </div>
            {usedPercentage !== null ? (
              <div className="text-secondary-label text-2xs tabular-nums">{usedPercentage}</div>
            ) : null}
          </div>
          {maxTokens !== null ? (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(normalizedPercentage)}
              aria-label={message("chat.contextMeter.title")}
              aria-valuetext={accessibleUsage}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${normalizedPercentage}%`, backgroundColor: usageColor }}
              />
            </div>
          ) : null}
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-2xs leading-4 text-secondary-label">
            <dt>{message("chat.contextMeter.usedTokens")}</dt>
            <dd className="text-right font-medium tabular-nums">{number(usage.usedTokens)}</dd>
            <dt>{message("chat.contextMeter.limit")}</dt>
            <dd className="text-right font-medium tabular-nums">
              {maxTokens === null ? message("chat.contextMeter.limitUnknown") : number(maxTokens)}
            </dd>
            {showTotalProcessed ? (
              <>
                <dt>{message("chat.contextMeter.processed")}</dt>
                <dd className="text-right font-medium tabular-nums">
                  {number(totalProcessedTokens)}
                </dd>
              </>
            ) : null}
          </dl>
          {usage.compactsAutomatically ? (
            <div className="mt-1 text-pretty text-secondary-label text-2xs font-medium">
              {formatContextWindowCompactionMessage(
                translator,
                modelDisplayName,
                usage.autoCompactThreshold,
              )}
            </div>
          ) : null}
          {onCompact ? (
            <>
              <Button size="xs" variant="outline" disabled={compactDisabled} onClick={onCompact}>
                <Minimize2Icon aria-hidden="true" />
                {message("chat.contextMeter.compact")}
              </Button>
              {compactDisabled && compactDisabledReason ? (
                <div className="text-pretty text-secondary-label text-2xs">
                  {compactDisabledReason}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Holds the meter's footprint while a thread's activities are still loading. */
function ContextWindowMeterPlaceholder() {
  return <span aria-hidden="true" className="size-7 shrink-0 pointer-coarse:size-11" />;
}
