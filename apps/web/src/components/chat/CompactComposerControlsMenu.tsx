import { type ComposerMode, type ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { EllipsisIcon } from "lucide-react";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  interactionMode: ProviderInteractionMode;
  composerMode?: ComposerMode;
  deepPlanningDisabledReason?: string | null | undefined;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  planningEnabled?: boolean;
  traitsMenuContent?: ReactNode;
  size?: "sm" | "xs";
  /**
   * The resting strip keeps this menu mounted out of flow while every block
   * fits inline. Its portaled popup would outlive that transition, so an
   * open menu closes when its trigger hides.
   */
  hidden?: boolean;
  onToggleInteractionMode: () => void;
  onComposerModeChange?: (mode: ComposerMode) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const composerFloatingLayerProps = useComposerMenuProps();
  const size = props.size ?? "sm";
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const composerMode = props.composerMode ?? props.interactionMode;

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <ComposerControl
            size={size}
            variant="ghost"
            className={size === "xs" ? "shrink-0" : "shrink-0 px-2"}
            aria-label={translate("chat.composer.moreControls")}
            data-composer-shortcut={
              props.traitsMenuContent ? "composer.mode composer.effort" : "composer.mode"
            }
          />
        }
      >
        <ComposerControlIcon icon={EllipsisIcon} size={size} />
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
              {translate("chat.composer.mode")}
            </div>
            <MenuRadioGroup
              value={composerMode}
              onValueChange={(value) => {
                if (!value || value === composerMode) return;
                if (
                  value !== "default" &&
                  value !== "plan" &&
                  value !== "deep-plan" &&
                  value !== "chat"
                )
                  return;
                if (props.onComposerModeChange) props.onComposerModeChange(value);
                else props.onToggleInteractionMode();
              }}
            >
              <MenuRadioItem value="default">
                {translate("chat.composer.interaction.build")}
              </MenuRadioItem>
              <MenuRadioItem value="plan" disabled={props.planningEnabled === false}>
                {translate("chat.composer.mode.plan")}
              </MenuRadioItem>
              <MenuRadioItem
                value="deep-plan"
                disabled={props.planningEnabled === false || !!props.deepPlanningDisabledReason}
              >
                <span className="grid min-w-0 gap-0.5">
                  <span>{translate("chat.deepPlan.label")}</span>
                  {props.deepPlanningDisabledReason ? (
                    <span className="whitespace-normal text-xs text-muted-foreground">
                      {props.deepPlanningDisabledReason}
                    </span>
                  ) : null}
                </span>
              </MenuRadioItem>
              <MenuRadioItem value="chat">{translate("chat.composer.mode.chat")}</MenuRadioItem>
            </MenuRadioGroup>
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
          {translate("chat.composer.access")}
        </div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          <MenuRadioItem value="approval-required">
            {translate("chat.composer.access.supervised")}
          </MenuRadioItem>
          <MenuRadioItem value="auto-accept-edits">
            {translate("chat.composer.access.autoAccept")}
          </MenuRadioItem>
          <MenuRadioItem value="auto">{translate("chat.composer.access.auto")}</MenuRadioItem>
          <MenuRadioItem value="full-access">
            {translate("chat.composer.access.full")}
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
});
