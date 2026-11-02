import type { ComposerMode } from "@t3tools/contracts";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, useRef } from "react";
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
import { focusRequestedPermission, useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";
import { ComposerPermissionsSection, type RuntimeModeOption } from "./ComposerFooterControls";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  interactionMode: ProviderInteractionMode;
  composerMode?: ComposerMode;
  deepPlanningDisabledReason?: string | null | undefined;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  showInteractionModeToggle: boolean;
  planningEnabled?: boolean;
  showPermissions?: boolean;
  size?: "sm" | "xs";
  /** Close the portaled popup when its trigger hides. */
  hidden?: boolean;
  onToggleInteractionMode: () => void;
  onComposerModeChange?: (mode: ComposerMode) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const composerMode = props.composerMode ?? props.interactionMode;
  const translate = useInterfaceTranslator().message;
  const composerFloatingLayerProps = useComposerMenuProps();
  const size = props.size ?? "sm";
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => focusRequestedPermission(isOpen, triggerRef.current)}
    >
      <MenuTrigger
        render={
          <ComposerControl
            ref={triggerRef}
            size={size}
            className="shrink-0"
            aria-label="More composer controls"
            data-composer-shortcut={props.showPermissions !== false ? "composer.mode" : undefined}
          />
        }
      >
        <ComposerControlIcon icon={EllipsisIcon} size={size} />
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
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
            {props.showPermissions !== false ? <MenuDivider /> : null}
          </>
        ) : null}
        {props.showPermissions === false ? null : (
          <ComposerPermissionsSection
            runtimeMode={props.runtimeMode}
            runtimeModeOptions={props.runtimeModeOptions}
            onRuntimeModeChange={props.onRuntimeModeChange}
          />
        )}
      </MenuPopup>
    </Menu>
  );
});
