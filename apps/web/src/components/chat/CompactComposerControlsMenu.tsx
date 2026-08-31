import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { Fragment, memo, type ReactNode, type SyntheticEvent } from "react";
import { EllipsisIcon } from "lucide-react";
import { Button } from "../ui/button";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
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

export type CompactComposerMenuSectionId =
  | "traits"
  | "context-window"
  | "interaction-mode"
  | "runtime-mode";

export function compactComposerMenuSectionIds(input: {
  readonly hasTraits: boolean;
  readonly hasContextWindow: boolean;
  readonly showInteractionMode: boolean;
}): ReadonlyArray<CompactComposerMenuSectionId> {
  return [
    ...(input.hasTraits ? (["traits"] as const) : []),
    ...(input.hasContextWindow ? (["context-window"] as const) : []),
    ...(input.showInteractionMode ? (["interaction-mode"] as const) : []),
    "runtime-mode",
  ];
}

export function compactComposerPopupClassName(hasContextWindow: boolean): string | undefined {
  return hasContextWindow ? "w-72 max-w-[calc(100vw-1.5rem)]" : undefined;
}

export function stopCompactComposerMenuInteractionPropagation(
  event: Pick<SyntheticEvent, "stopPropagation">,
): void {
  event.stopPropagation();
}

export function stopCompactComposerMenuNavigationKeyPropagation(
  event: Readonly<{ key: string; stopPropagation: () => void }>,
): void {
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
  const translate = useInterfaceTranslator().message;
  const sectionIds = compactComposerMenuSectionIds({
    hasTraits: Boolean(props.traitsMenuContent),
    hasContextWindow: Boolean(props.contextWindowMenuContent),
    showInteractionMode: props.showInteractionModeSelect,
  });

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label={translate("chat.composer.moreControls")}
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        className={compactComposerPopupClassName(Boolean(props.contextWindowMenuContent))}
      >
        {sectionIds.map((sectionId, index) => (
          <Fragment key={sectionId}>
            {sectionId === "traits" ? props.traitsMenuContent : null}
            {sectionId === "context-window" ? (
              <div
                onPointerDown={stopCompactComposerMenuInteractionPropagation}
                onClick={stopCompactComposerMenuInteractionPropagation}
                onKeyDown={stopCompactComposerMenuNavigationKeyPropagation}
              >
                {props.contextWindowMenuContent}
              </div>
            ) : null}
            {sectionId === "interaction-mode" ? (
              <>
                <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                  {translate("chat.composer.mode")}
                </div>
                <MenuRadioGroup
                  value={props.interactionMode}
                  onValueChange={(value) => {
                    if (!value || value === props.interactionMode) return;
                    props.onInteractionModeChange(value as ProviderInteractionMode);
                  }}
                >
                  <MenuRadioItem value="default">
                    {translate("chat.composer.mode.chat")}
                  </MenuRadioItem>
                  <MenuRadioItem value="plan">{translate("chat.composer.mode.plan")}</MenuRadioItem>
                </MenuRadioGroup>
              </>
            ) : null}
            {sectionId === "runtime-mode" ? (
              <>
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
                  <MenuRadioItem value="auto">
                    {translate("chat.composer.access.auto")}
                  </MenuRadioItem>
                  <MenuRadioItem value="full-access">
                    {translate("chat.composer.access.full")}
                  </MenuRadioItem>
                </MenuRadioGroup>
              </>
            ) : null}
            {index < sectionIds.length - 1 ? <MenuDivider /> : null}
          </Fragment>
        ))}
      </MenuPopup>
    </Menu>
  );
});
