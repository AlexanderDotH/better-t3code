import type { ComposerMode } from "@t3tools/contracts";
import { BotIcon, MessageCircleIcon, PencilRulerIcon } from "lucide-react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ComposerControl,
  ComposerControlChevron,
  ComposerControlIcon,
  type ComposerControlSize,
} from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

const MODE_OPTIONS = [
  {
    mode: "default",
    label: "chat.composer.interaction.build",
    description: "chat.composer.interaction.buildDescription",
    icon: BotIcon,
  },
  {
    mode: "plan",
    label: "chat.composer.mode.plan",
    description: "chat.composer.interaction.planDescription",
    icon: PencilRulerIcon,
  },
  {
    mode: "deep-plan",
    label: "chat.deepPlan.label",
    description: "chat.deepPlan.slashDescription",
    icon: PencilRulerIcon,
  },
  {
    mode: "chat",
    label: "chat.composer.mode.chat",
    description: "chat.composer.interaction.chatDescription",
    icon: MessageCircleIcon,
  },
] as const;

export function ComposerModeMenuItems({
  mode,
  planningEnabled = true,
  planningDisabledReason,
  deepPlanningDisabledReason,
  onModeChange,
}: {
  mode: ComposerMode;
  planningEnabled?: boolean | undefined;
  planningDisabledReason?: string | null | undefined;
  deepPlanningDisabledReason?: string | null | undefined;
  onModeChange: (mode: ComposerMode) => void;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <MenuRadioGroup
      value={mode}
      aria-label={translate("chat.composer.mode")}
      onValueChange={(value) => {
        const option = MODE_OPTIONS.find((candidate) => candidate.mode === value);
        if (!option || option.mode === mode) return;
        if ((option.mode === "plan" || option.mode === "deep-plan") && !planningEnabled) return;
        if (option.mode === "deep-plan" && deepPlanningDisabledReason) return;
        onModeChange(option.mode);
      }}
    >
      {MODE_OPTIONS.map((option) => {
        const planning = option.mode === "plan" || option.mode === "deep-plan";
        const disabledReason =
          planning && !planningEnabled
            ? planningDisabledReason
            : option.mode === "deep-plan"
              ? deepPlanningDisabledReason
              : null;
        return (
          <MenuRadioItem
            key={option.mode}
            value={option.mode}
            label={translate(option.label)}
            aria-label={translate(option.label)}
            disabled={(planning && !planningEnabled) || !!disabledReason}
            closeOnClick
          >
            <option.icon aria-hidden="true" />
            <span className="grid min-w-0 max-w-64 gap-0.5">
              <span>{translate(option.label)}</span>
              <span className="whitespace-normal text-xs text-muted-foreground">
                {disabledReason || translate(option.description)}
              </span>
            </span>
          </MenuRadioItem>
        );
      })}
    </MenuRadioGroup>
  );
}

export function ComposerInteractionModeButton({
  mode,
  size = "sm",
  disabledReason,
  planningEnabled,
  planningDisabledReason,
  hidden,
  onModeChange,
  onCycle,
}: {
  mode: ComposerMode;
  size?: ComposerControlSize;
  disabledReason?: string | null | undefined;
  planningEnabled?: boolean | undefined;
  planningDisabledReason?: string | null | undefined;
  hidden?: boolean | undefined;
  onModeChange?: ((mode: ComposerMode) => void) | undefined;
  onCycle: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  const floatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(hidden);
  const option = MODE_OPTIONS.find((candidate) => candidate.mode === mode) ?? MODE_OPTIONS[0];
  const description = translate(option.description);
  const control = (
    <ComposerControl
      size={size}
      className="shrink-0 whitespace-nowrap"
      aria-pressed={onModeChange ? undefined : mode !== "default"}
      aria-label={
        onModeChange
          ? `${translate("chat.composer.mode")}: ${translate(option.label)}`
          : description
      }
      onClick={onModeChange ? undefined : onCycle}
      onKeyDown={(event) => {
        if (event.key === "Tab" && event.shiftKey) {
          event.preventDefault();
          onCycle();
        }
      }}
    />
  );
  const trigger = (
    <Tooltip>
      <TooltipTrigger render={onModeChange ? <MenuTrigger render={control} /> : control}>
        <ComposerControlIcon
          icon={option.icon}
          size={size}
          opticalSize={size === "xs" || mode !== "default" ? "default" : "large"}
        />
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          {translate(option.label)}
        </span>
        {onModeChange ? <ComposerControlChevron size={size} /> : null}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {disabledReason && mode === "plan" ? `${description} · ${disabledReason}` : description}
      </TooltipPopup>
    </Tooltip>
  );
  if (!onModeChange) return trigger;
  return (
    <Menu open={open} onOpenChange={setOpen}>
      {trigger}
      <MenuPopup align="start" {...floatingLayerProps}>
        <ComposerModeMenuItems
          mode={mode}
          onModeChange={onModeChange}
          planningEnabled={planningEnabled}
          planningDisabledReason={planningDisabledReason}
          deepPlanningDisabledReason={disabledReason}
        />
      </MenuPopup>
    </Menu>
  );
}
