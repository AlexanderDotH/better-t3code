import type { ComposerMode } from "@t3tools/contracts";
import { BotIcon, PencilRulerIcon } from "lucide-react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";

export function ComposerInteractionModeButton({
  mode,
  size = "sm",
  disabledReason,
  onCycle,
}: {
  mode: ComposerMode;
  size?: ComposerControlSize;
  disabledReason?: string | null | undefined;
  onCycle: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  const description = translate(
    mode === "deep-plan"
      ? "chat.deepPlan.slashDescription"
      : mode === "plan"
        ? "chat.composer.interaction.planDescription"
        : "chat.composer.interaction.buildDescription",
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            size={size}
            className="shrink-0 whitespace-nowrap"
            aria-pressed={mode !== "default"}
            aria-label={description}
            onClick={onCycle}
            onKeyDown={(event) => {
              if (event.key === "Tab" && event.shiftKey) {
                event.preventDefault();
                onCycle();
              }
            }}
          />
        }
      >
        <ComposerControlIcon
          icon={mode === "default" ? BotIcon : PencilRulerIcon}
          size={size}
          opticalSize={size === "xs" || mode !== "default" ? "default" : "large"}
        />
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          {translate(
            mode === "deep-plan"
              ? "chat.deepPlan.label"
              : mode === "plan"
                ? "chat.composer.mode.plan"
                : "chat.composer.interaction.build",
          )}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {disabledReason && mode === "plan" ? `${description} · ${disabledReason}` : description}
      </TooltipPopup>
    </Tooltip>
  );
}
