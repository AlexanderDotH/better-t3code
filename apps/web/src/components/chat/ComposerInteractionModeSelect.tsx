import type { ProviderInteractionMode } from "@t3tools/contracts";
import { BotIcon, PencilRulerIcon, type LucideIcon } from "lucide-react";
import { memo } from "react";

import { ComposerControlIcon, ComposerSelectControl } from "./ComposerControl";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

const interactionModeOptions: ReadonlyArray<ProviderInteractionMode> = ["default", "plan"];

const interactionModeConfig: Record<
  ProviderInteractionMode,
  {
    readonly labelKey: "chat.composer.interaction.build" | "chat.composer.mode.plan";
    readonly descriptionKey:
      | "chat.composer.interaction.buildDescription"
      | "chat.composer.interaction.planDescription";
    readonly icon: LucideIcon;
  }
> = {
  default: {
    labelKey: "chat.composer.interaction.build",
    descriptionKey: "chat.composer.interaction.buildDescription",
    icon: BotIcon,
  },
  plan: {
    labelKey: "chat.composer.mode.plan",
    descriptionKey: "chat.composer.interaction.planDescription",
    icon: PencilRulerIcon,
  },
};

export const ComposerInteractionModeSelect = memo(function ComposerInteractionModeSelect(props: {
  readonly value: ProviderInteractionMode;
  readonly onValueChange: (value: ProviderInteractionMode) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const selected = interactionModeConfig[props.value];
  const SelectedIcon = selected.icon;

  return (
    <Tooltip>
      <Select
        value={props.value}
        onValueChange={(value) => {
          if (value) props.onValueChange(value);
        }}
      >
        <TooltipTrigger
          render={
            <ComposerSelectControl
              className="font-medium"
              aria-label={translate("chat.composer.interactionMode")}
            />
          }
        >
          <ComposerControlIcon icon={SelectedIcon} />
          <SelectValue>{translate(selected.labelKey)}</SelectValue>
        </TooltipTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {interactionModeOptions.map((mode) => {
            const option = interactionModeConfig[mode];
            const OptionIcon = option.icon;
            return (
              <SelectItem key={mode} value={mode} hideIndicator className="min-w-64 py-2">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    {translate(option.labelKey)}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {translate(option.descriptionKey)}
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
      <TooltipPopup side="top">{translate(selected.descriptionKey)}</TooltipPopup>
    </Tooltip>
  );
});
