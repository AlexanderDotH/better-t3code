import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { ArrowUpIcon, BotIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { useId } from "react";

import { cn } from "../../lib/utils";
import { ContextWindowMeterRing } from "../chat/ContextWindowMeterRing";

const EXAMPLE_CONTEXT = { usedTokens: 64_000, maxTokens: 128_000, usedPercentage: 50 };

function ComposerPreview(props: {
  readonly enabled: boolean;
  readonly expanded: boolean;
  readonly translate: InterfaceTranslator["message"];
}) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-border/70 bg-card p-3 shadow-xs",
        props.expanded ? "flex h-28 flex-col justify-between" : "flex items-center gap-2",
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs text-placeholder",
          props.expanded && props.enabled && "pr-11",
        )}
      >
        {props.translate("settings.betterT3.preview.chat.prompt")}
      </span>
      {props.expanded && props.enabled ? (
        <div className="absolute top-3 right-3 flex size-7 items-center justify-center">
          <ContextWindowMeterRing percentage={EXAMPLE_CONTEXT.usedPercentage} />
        </div>
      ) : null}
      <div className={cn("flex shrink-0 items-center gap-2", props.expanded && "justify-between")}>
        {props.expanded ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-md border border-border/70 bg-background px-1.5 text-muted-foreground">
            <BotIcon className="size-3" />
            <span className="h-1.5 w-5 rounded-full bg-current opacity-45" />
            <ChevronDownIcon className="size-3" />
          </span>
        ) : props.enabled ? (
          <span className="flex size-7 items-center justify-center">
            <ContextWindowMeterRing percentage={EXAMPLE_CONTEXT.usedPercentage} />
          </span>
        ) : null}
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-message-action text-message-action-foreground">
          <ArrowUpIcon className="size-3.5" />
        </span>
      </div>
    </div>
  );
}

export function ContextWindowMeterChoice(props: {
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => void;
  readonly translator: InterfaceTranslator;
}) {
  const exampleId = useId();
  const { message, number } = props.translator;

  return (
    <div className="pb-2 pt-3">
      <p id={exampleId} className="pb-3 text-pretty text-xs text-muted-foreground tabular-nums">
        {message("settings.contextMeter.preview.example", {
          used: number(EXAMPLE_CONTEXT.usedTokens),
          limit: number(EXAMPLE_CONTEXT.maxTokens),
          percentage: number(EXAMPLE_CONTEXT.usedPercentage / 100, { style: "percent" }),
        })}
      </p>
      <div
        aria-label={message("settings.contextMeter.label")}
        aria-describedby={exampleId}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        role="radiogroup"
        onKeyDown={(event) => {
          const nextEnabled =
            event.key === "Home"
              ? false
              : event.key === "End"
                ? true
                : ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
                  ? !props.enabled
                  : null;
          if (nextEnabled === null) return;
          event.preventDefault();
          props.onChange(nextEnabled);
          const choices = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
          choices[nextEnabled ? 1 : 0]?.focus();
        }}
      >
        {[false, true].map((enabled) => {
          const selected = enabled === props.enabled;
          return (
            <button
              aria-checked={selected}
              className={cn(
                "better-t3-feature-option min-w-0 cursor-pointer overflow-hidden rounded-xl border bg-card text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected ? "border-primary/65" : "border-border/70 hover:border-primary/35",
              )}
              key={String(enabled)}
              onClick={() => props.onChange(enabled)}
              role="radio"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <div aria-hidden="true" className="space-y-3 bg-muted/25 p-3">
                {[false, true].map((expanded) => (
                  <div className="space-y-1.5" key={String(expanded)}>
                    <div className="text-3xs font-medium text-muted-foreground">
                      {message(
                        expanded
                          ? "settings.contextMeter.preview.expanded"
                          : "settings.contextMeter.preview.singleLine",
                      )}
                    </div>
                    <ComposerPreview enabled={enabled} expanded={expanded} translate={message} />
                  </div>
                ))}
              </div>
              <span className="flex min-h-10 items-center justify-between gap-3 border-t border-border/50 px-3 py-2 text-xs font-medium">
                {message(
                  enabled
                    ? "settings.contextMeter.preview.on"
                    : "settings.contextMeter.preview.off",
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    "better-t3-preview-selection flex size-4 shrink-0 items-center justify-center rounded-full border",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/35 bg-background",
                  )}
                >
                  {selected ? <CheckIcon className="size-2.5" strokeWidth={3} /> : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
