import type { ComposerMode } from "@t3tools/contracts";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode, useRef } from "react";
import { EllipsisIcon } from "lucide-react";
import { Menu, MenuPopup, MenuSeparator as MenuDivider, MenuTrigger } from "../ui/menu";
import { ComposerModeMenuItems } from "./ComposerInteractionModeButton";
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
  contextWindowContent?: ReactNode;
  traitsContent?: ReactNode;
  planningDisabledReason?: string | null | undefined;
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
            aria-label={translate("chat.composer.moreControls")}
            data-composer-shortcut={
              [
                props.traitsContent ? "composer.effort" : null,
                props.showPermissions !== false ? "composer.mode" : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
          />
        }
      >
        <ComposerControlIcon icon={EllipsisIcon} size={size} />
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        {props.traitsContent}
        {props.traitsContent && props.contextWindowContent ? <MenuDivider /> : null}
        {props.contextWindowContent}
        {(props.traitsContent || props.contextWindowContent) &&
        (props.showInteractionModeToggle || props.showPermissions !== false) ? (
          <MenuDivider />
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
              {translate("chat.composer.mode")}
            </div>
            <ComposerModeMenuItems
              mode={composerMode}
              planningEnabled={props.planningEnabled}
              planningDisabledReason={props.planningDisabledReason}
              deepPlanningDisabledReason={props.deepPlanningDisabledReason}
              onModeChange={(mode) => {
                if (props.onComposerModeChange) props.onComposerModeChange(mode);
                else props.onToggleInteractionMode();
              }}
            />
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
