import type { ProviderInteractionMode } from "@t3tools/contracts";
import { BotIcon, PencilRulerIcon, type LucideIcon } from "lucide-react";
import { memo } from "react";

import { ComposerControlIcon, ComposerSelectControl } from "./ComposerControl";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const interactionModeOptions: ReadonlyArray<ProviderInteractionMode> = ["default", "plan"];

const interactionModeConfig: Record<
  ProviderInteractionMode,
  { readonly label: string; readonly description: string; readonly icon: LucideIcon }
> = {
  default: {
    label: "Build",
    description: "Work directly on the task",
    icon: BotIcon,
  },
  plan: {
    label: "Plan",
    description: "Explore and agree on a plan before implementation",
    icon: PencilRulerIcon,
  },
};

export const ComposerInteractionModeSelect = memo(function ComposerInteractionModeSelect(props: {
  readonly value: ProviderInteractionMode;
  readonly onValueChange: (value: ProviderInteractionMode) => void;
}) {
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
          render={<ComposerSelectControl className="font-medium" aria-label="Interaction mode" />}
        >
          <ComposerControlIcon icon={SelectedIcon} />
          <SelectValue>{selected.label}</SelectValue>
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
                    {option.label}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {option.description}
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
      <TooltipPopup side="top">{selected.description}</TooltipPopup>
    </Tooltip>
  );
});
