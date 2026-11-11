import {
  describeThreadTokenUsage,
  formatTokenTotal,
  type ThreadTokenUsage,
  type TokenUsageSection,
  type TokenUsageSegment,
} from "@t3tools/client-runtime/thread-token-usage";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const SEGMENT_TONES = ["bg-foreground/75", "bg-foreground/35", "bg-foreground/15"] as const;

function TokenSplit(props: { readonly segments: ReadonlyArray<TokenUsageSegment> }) {
  const { number } = useInterfaceTranslator();
  const segments = props.segments.map((segment, index) => ({
    ...segment,
    tone: SEGMENT_TONES[index] ?? SEGMENT_TONES[2],
  }));
  return (
    <div className="space-y-1.5" data-token-split>
      <div aria-hidden className="flex h-1.5 gap-px overflow-hidden rounded-full">
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <div
              key={segment.label}
              className={`min-w-0.5 ${segment.tone}`}
              style={{ flexGrow: segment.value, flexBasis: 0 }}
            />
          ))}
      </div>
      <dl className="space-y-0.5 text-muted-foreground">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-baseline gap-1.5">
            <span
              aria-hidden
              className={`size-1.5 shrink-0 self-center rounded-xs ${segment.tone}`}
            />
            <dt className="min-w-0 flex-1 truncate">{segment.label}</dt>
            <dd className="tabular-nums">{number(segment.value)}</dd>
            <span className="w-9 text-right text-3xs tabular-nums">{segment.share}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TokenSectionDetails({ section }: { readonly section: TokenUsageSection }) {
  const { number } = useInterfaceTranslator();
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <h4 className="font-medium">{section.title}</h4>
        <span className="text-sm font-semibold tabular-nums">
          {number(section.total)}
          {section.partial ? "+" : ""}
        </span>
      </div>
      {section.splits.map((segments) => (
        <TokenSplit key={segments[0]?.label} segments={segments} />
      ))}
    </section>
  );
}

function TokenTotal(props: {
  readonly value: number;
  readonly partial: boolean;
  readonly label: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-medium text-foreground/80">
        {formatTokenTotal(props.value, props.partial)}
      </span>
      <span>{props.label}</span>
    </span>
  );
}

export function ComposerTokenUsageMetrics({
  usage,
  tooltipSide = "top",
}: {
  readonly usage: ThreadTokenUsage;
  readonly tooltipSide?: "top" | "bottom";
}) {
  const translator = useInterfaceTranslator();
  const { message, number } = translator;
  const inputLabel = message("chat.timeline.inputTokens");
  const outputLabel = message("chat.timeline.outputTokens");
  const inputPartial = usage.inputIsPartial && usage.inputTokens > 0 ? "+" : "";
  const outputPartial = usage.outputIsPartial && usage.outputTokens > 0 ? "+" : "";
  const { sections, notes } = describeThreadTokenUsage(usage, translator);
  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        render={<span tabIndex={0} />}
        aria-label={`${inputLabel}: ${number(usage.inputTokens)}${inputPartial}, ${outputLabel}: ${number(usage.outputTokens)}${outputPartial}`}
        className="inline-flex cursor-help items-baseline gap-1.5 rounded-sm text-xs leading-4 whitespace-nowrap text-muted-foreground tabular-nums focus-visible:outline-2 focus-visible:outline-ring"
        data-composer-token-totals
      >
        <TokenTotal
          value={usage.inputTokens}
          partial={usage.inputIsPartial}
          label={message("chat.tokens.inShort")}
        />
        <span aria-hidden className="text-muted-foreground/40">
          ·
        </span>
        <TokenTotal
          value={usage.outputTokens}
          partial={usage.outputIsPartial}
          label={message("chat.tokens.outShort")}
        />
      </TooltipTrigger>
      <TooltipPopup side={tooltipSide} sideOffset={8} className="w-72 max-w-[calc(100vw-2rem)]">
        <div className="space-y-3.5 p-1.5 text-left">
          {sections.map((section) => (
            <TokenSectionDetails key={section.id} section={section} />
          ))}
          {notes.length > 0 ? (
            <div className="space-y-0.5 border-t border-border/50 pt-2 text-3xs text-muted-foreground">
              {notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
