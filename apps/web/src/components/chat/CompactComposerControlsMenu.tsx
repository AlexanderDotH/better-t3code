import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import { EllipsisIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

const INLINE_CONTROL_NAVIGATION_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

function stopMenuInteractionPropagation(event: SyntheticEvent): void {
  event.stopPropagation();
}

function stopMenuNavigationKeyPropagation(event: KeyboardEvent): void {
  if (!INLINE_CONTROL_NAVIGATION_KEYS.has(event.key)) return;
  event.stopPropagation();
}

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  showInteractionModeSelect: boolean;
  traitsMenuContent?: ReactNode;
  contextWindowMenuContent?: ReactNode;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="More composer controls"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        className={props.contextWindowMenuContent ? "w-72 max-w-[calc(100vw-1.5rem)]" : undefined}
      >
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        {props.contextWindowMenuContent ? (
          <>
            <div
              onPointerDown={stopMenuInteractionPropagation}
              onClick={stopMenuInteractionPropagation}
              onKeyDown={stopMenuNavigationKeyPropagation}
            >
              {props.contextWindowMenuContent}
            </div>
            <MenuDivider />
          </>
        ) : null}
        {props.showInteractionModeSelect ? (
          <>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
            <MenuRadioGroup
              value={props.interactionMode}
              onValueChange={(value) => {
                if (!value || value === props.interactionMode) return;
                props.onInteractionModeChange(value as ProviderInteractionMode);
              }}
            >
              <MenuRadioItem value="default">Chat</MenuRadioItem>
              <MenuRadioItem value="plan">Plan</MenuRadioItem>
            </MenuRadioGroup>
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          <MenuRadioItem value="approval-required">Supervised</MenuRadioItem>
          <MenuRadioItem value="auto-accept-edits">Auto-accept edits</MenuRadioItem>
          <MenuRadioItem value="auto">Auto</MenuRadioItem>
          <MenuRadioItem value="full-access">Full access</MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
});
