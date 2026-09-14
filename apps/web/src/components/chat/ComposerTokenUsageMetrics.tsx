import { ArrowDownToLineIcon, ArrowUpFromLineIcon } from "lucide-react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import type { ThreadTokenUsage, TokenUsageBreakdown } from "../../lib/threadTokenUsage";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type TokenDirection = "input" | "output";

function TokenUsageIndicator(props: {
  readonly segments: readonly { readonly value: number; readonly className: string }[];
  readonly outline?: boolean;
}) {
  const total = props.segments.reduce((sum, segment) => sum + segment.value, 0);
  const segments = [];
  let offset = 0;
  for (const segment of props.segments) {
    const percentage = total > 0 ? (segment.value / total) * 100 : 0;
    segments.push({ ...segment, percentage, start: offset });
    offset += percentage;
  }
  if (props.outline) {
    return (
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        fill="none"
        strokeWidth={1.25}
      >
        <rect
          x="1"
          y="1"
          width="calc(100% - 2px)"
          height="calc(100% - 2px)"
          rx="5"
          className="stroke-muted-foreground/20"
        />
        <g opacity={0.65}>
          {segments
            .filter((segment) => segment.percentage > 0)
            .map((segment, index) => (
              <rect
                key={segment.className}
                x="1"
                y="1"
                width="calc(100% - 2px)"
                height="calc(100% - 2px)"
                rx="5"
                pathLength={100}
                stroke="currentColor"
                strokeDasharray={index === 0 ? undefined : `${segment.percentage} 100`}
                strokeDashoffset={-segment.start}
                className={segment.className}
              />
            ))}
        </g>
      </svg>
    );
  }
  return (
    <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-muted-foreground/10">
      {segments.map((segment) => (
        <div
          key={segment.className}
          className={segment.className}
          style={{ width: `${segment.percentage}%` }}
        />
      ))}
    </div>
  );
}

function TokenUsageSource(props: {
  readonly label: string;
  readonly usage: TokenUsageBreakdown;
  readonly direction: TokenDirection;
  readonly total: number;
  readonly className: string;
  readonly showBar: boolean;
}) {
  const { message, number } = useInterfaceTranslator();
  const value = props.direction === "input" ? props.usage.inputTokens : props.usage.outputTokens;
  const reportedSubset =
    props.direction === "input" ? props.usage.cachedInputTokens : props.usage.reasoningOutputTokens;
  const subset = reportedSubset === null ? null : Math.min(value ?? 0, reportedSubset);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={`size-1.5 shrink-0 rounded-full ${props.className}`} aria-hidden />
        <span className="flex-1 font-medium">{props.label}</span>
        <span className="font-mono tabular-nums">{value === null ? "—" : number(value)}</span>
        <span className="w-9 text-right text-[10px] text-muted-foreground tabular-nums">
          {value !== null && props.total > 0
            ? number(value / props.total, { style: "percent", maximumFractionDigits: 0 })
            : "—"}
        </span>
      </div>
      {props.showBar ? (
        <TokenUsageIndicator
          segments={[
            { value: Math.max(0, (value ?? 0) - (subset ?? 0)), className: props.className },
            { value: subset ?? 0, className: `${props.className} opacity-35` },
          ]}
        />
      ) : null}
      <div className="flex justify-between gap-3 text-[10px] leading-4 text-muted-foreground">
        <span>
          {message(props.direction === "input" ? "chat.tokens.uncached" : "chat.tokens.response")}{" "}
          <span className="font-mono tabular-nums">
            {value === null || subset === null ? "—" : number(value - subset)}
          </span>
        </span>
        <span>
          {message(props.direction === "input" ? "chat.tokens.cached" : "chat.tokens.reasoning")}{" "}
          <span className="font-mono tabular-nums">{subset === null ? "—" : number(subset)}</span>
        </span>
      </div>
    </div>
  );
}

export function ComposerTokenUsageMetrics({ usage }: { readonly usage: ThreadTokenUsage }) {
  const { message, number } = useInterfaceTranslator();
  const hasSubagents = usage.agentCount > 0;
  return (["input", "output"] as const).map((direction) => {
    const isInput = direction === "input";
    const label = message(isInput ? "chat.timeline.inputTokens" : "chat.timeline.outputTokens");
    const value = isInput ? usage.inputTokens : usage.outputTokens;
    const partial = isInput ? usage.inputIsPartial : usage.outputIsPartial;
    const Icon = isInput ? ArrowDownToLineIcon : ArrowUpFromLineIcon;
    const sources = [
      {
        label: message("chat.tokens.mainAgent"),
        usage: usage.mainAgent,
        className: "bg-primary text-primary",
      },
      {
        label: message("chat.tokens.subagents", { count: usage.agentCount }),
        usage: usage.subagents,
        className: "bg-sky-500 text-sky-500 dark:bg-sky-300/80 dark:text-sky-300/80",
      },
    ].slice(0, hasSubagents ? 2 : 1);
    return (
      <Tooltip key={direction}>
        <TooltipTrigger
          delay={0}
          render={<span tabIndex={0} />}
          aria-label={`${label}: ${number(value)}${partial ? "+" : ""}`}
          className="relative inline-flex cursor-help items-center gap-1 rounded-md bg-background/35 px-2 py-1 text-[10px] leading-4 text-muted-foreground tabular-nums transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          data-composer-token-direction={direction}
        >
          {hasSubagents ? (
            <TokenUsageIndicator
              outline
              segments={sources.map((source) => ({
                value: (isInput ? source.usage.inputTokens : source.usage.outputTokens) ?? 0,
                className: source.className,
              }))}
            />
          ) : null}
          <Icon aria-hidden className="size-3" strokeWidth={1.75} />
          <span className="font-mono font-medium text-foreground/75">
            {formatContextWindowTokens(value)}
            {partial && value > 0 ? "+" : ""}
          </span>
        </TooltipTrigger>
        <TooltipPopup
          side="top"
          align="end"
          sideOffset={8}
          className="w-72 max-w-[calc(100vw-2rem)] duration-75"
        >
          <div className="space-y-3 p-1.5 text-left">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">
                  {message("chat.tokens.title", { direction: label })}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {message("chat.tokens.scope")}
                </div>
              </div>
              <span className="font-mono text-base font-semibold tabular-nums">
                {number(value)}
                {partial && value > 0 ? "+" : ""}
              </span>
            </div>
            {sources.map((source) => (
              <TokenUsageSource
                key={source.label}
                {...source}
                direction={direction}
                total={value}
                showBar={hasSubagents}
              />
            ))}
          </div>
        </TooltipPopup>
      </Tooltip>
    );
  });
}
