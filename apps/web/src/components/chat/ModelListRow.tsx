import { type ProviderDriverKind, type ProviderInstanceId } from "@t3tools/contracts";
import { formatModelContextWindowTokens } from "@t3tools/shared/model";
import { memo } from "react";
import { StarIcon } from "lucide-react";
import {
  getDisplayModelName,
  getTriggerDisplayModelLabel,
  type ModelEsque,
} from "./providerIconUtils";
import { ComboboxItem } from "../ui/combobox";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { modelPickerModelKey } from "./modelPickerKeys";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

export function ModelCatalogMetadata(props: {
  readonly model: ModelEsque;
  readonly providerLabel: string;
}) {
  const contextTokens = props.model.capabilities?.contextWindow?.maxTokens;
  const pricing = props.model.capabilities?.pricing;
  const isFree = pricing?.promptUsdPerMillion === 0 && pricing.completionUsdPerMillion === 0;
  const supportsVision = props.model.capabilities?.inputModalities?.includes("image") === true;
  const supportsReasoning =
    props.model.capabilities?.optionDescriptors?.some(
      (descriptor) => descriptor.id === "reasoningEffort" && descriptor.type === "select",
    ) === true;
  const hasFeatureBadges = isFree || supportsVision || supportsReasoning;

  return (
    <div
      className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] leading-none text-muted-foreground/70"
      data-model-picker-catalog-metadata="true"
    >
      <span className="max-w-[38%] shrink-0 truncate font-medium text-muted-foreground">
        {props.providerLabel}
      </span>
      {contextTokens ? (
        <>
          <span className="shrink-0 opacity-35" aria-hidden="true">
            ·
          </span>
          <span className="shrink-0 tabular-nums">
            {formatModelContextWindowTokens(contextTokens)} context
          </span>
        </>
      ) : null}
      {hasFeatureBadges ? (
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          {isFree ? (
            <span className="shrink-0 rounded-[4px] bg-emerald-500/10 px-1 py-0.5 font-medium text-emerald-700 dark:text-emerald-300/90">
              Free
            </span>
          ) : null}
          {supportsVision ? (
            <span className="shrink-0 rounded-[4px] bg-foreground/[0.045] px-1 py-0.5">Vision</span>
          ) : null}
          {supportsReasoning ? (
            <span className="shrink-0 rounded-[4px] bg-foreground/[0.045] px-1 py-0.5">
              Reasoning
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export const ModelListRow = memo(function ModelListRow(props: {
  index: number;
  model: ModelEsque;
  /** Instance the model belongs to — the routing key used in combobox values. */
  instanceId: ProviderInstanceId;
  /** Driver kind of the instance — used for the provider icon glyph. */
  driverKind: ProviderDriverKind;
  /**
   * Display name to show in the secondary line (provider footer). Usually
   * the instance's configured `displayName` so custom instances like
   * "Codex Personal" render with their user-authored label.
   */
  providerDisplayName: string;
  providerAccentColor?: string | undefined;
  isFavorite: boolean;
  isSelected: boolean;
  showProvider: boolean;
  preferShortName?: boolean;
  useTriggerLabel?: boolean;
  showNewBadge?: boolean;
  jumpLabel?: string | null;
  disabledReason?: string | null;
  presentation?: "compact" | "catalog";
  onToggleFavorite: () => void;
}) {
  const isCatalogPresentation = props.presentation === "catalog";
  const showProviderContext =
    !isCatalogPresentation && (props.showProvider || Boolean(props.model.subProvider));
  const modelDisplayName = props.useTriggerLabel
    ? getTriggerDisplayModelLabel(props.model)
    : getDisplayModelName(
        props.model,
        props.preferShortName ? { preferShortName: true } : undefined,
      );
  const favoriteActionLabel = props.isFavorite
    ? `Remove ${modelDisplayName} from favorites`
    : `Add ${modelDisplayName} to favorites`;
  const providerLabel = props.model.subProvider
    ? props.showProvider && !isCatalogPresentation
      ? `${props.providerDisplayName} · ${props.model.subProvider}`
      : props.model.subProvider
    : props.providerDisplayName;

  const row = (
    <ComboboxItem
      hideIndicator
      index={props.index}
      value={modelPickerModelKey(props.instanceId, props.model.slug)}
      disabled={Boolean(props.disabledReason)}
      contentClassName="flex w-full items-center gap-3"
      className={cn(
        "group relative w-full !min-w-0 max-w-full cursor-pointer rounded-md px-2 py-1.5 transition-[background-color,box-shadow,color]",
        "hover:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))] data-highlighted:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))] data-selected:bg-foreground/[0.08] data-selected:text-foreground data-selected:ring-0 [&[data-highlighted][data-selected]]:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))]",
        isCatalogPresentation &&
          "rounded-lg border border-transparent px-2.5 py-2 hover:border-border/50 data-highlighted:border-border/60 data-selected:border-border/50 data-selected:bg-background/70",
        props.disabledReason &&
          "data-disabled:pointer-events-auto data-disabled:cursor-not-allowed data-disabled:hover:bg-transparent",
      )}
    >
      <div className="min-w-0 flex-1 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 truncate text-xs font-medium leading-snug">
              {modelDisplayName}
            </span>
            {props.showNewBadge ? (
              <span
                className="shrink-0 rounded border border-update/35 bg-update/15 px-0.5 py-px text-[10px] font-bold uppercase leading-none tracking-wide text-update-foreground"
                aria-label="New model"
              >
                New
              </span>
            ) : null}
          </div>
          {showProviderContext ? (
            <span
              className="flex min-w-0 max-w-[46%] shrink items-center gap-1.5 text-xs font-normal leading-snug text-muted-foreground/70"
              data-model-picker-provider-label="inline"
            >
              <ProviderInstanceIcon
                driverKind={props.driverKind}
                displayName={props.providerDisplayName}
                accentColor={props.providerAccentColor}
                showBadge={Boolean(props.providerAccentColor)}
                badgeContent="none"
                className="size-3"
                iconClassName="size-3"
                badgeClassName="-right-0.5 -bottom-0.5 size-1.5 min-w-1.5 border-0 p-0"
                indicatorBackground="var(--popover)"
              />
              <span className="truncate">{providerLabel}</span>
            </span>
          ) : null}
        </div>
        {isCatalogPresentation ? (
          <ModelCatalogMetadata model={props.model} providerLabel={providerLabel} />
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {props.jumpLabel ? (
          <Kbd className="h-4 min-w-0 rounded-sm px-1.5 text-[10px]">{props.jumpLabel}</Kbd>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className={cn(
                  "-mr-1 shrink-0 text-muted-foreground/70 opacity-64 transition-[color,opacity] hover:text-foreground hover:opacity-100 group-hover:opacity-100",
                  props.isFavorite && "text-foreground opacity-100",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleFavorite();
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
                aria-label={favoriteActionLabel}
              >
                <StarIcon
                  className={cn(
                    "size-3.5 sm:size-3",
                    props.isFavorite && "fill-current text-yellow-500",
                  )}
                />
              </Button>
            }
          />
          <TooltipPopup side="top" align="center">
            {favoriteActionLabel}
          </TooltipPopup>
        </Tooltip>
      </div>
    </ComboboxItem>
  );

  if (!props.disabledReason) {
    return row;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipPopup side="left" align="center" className="max-w-64 text-balance leading-snug">
        {props.disabledReason}
      </TooltipPopup>
    </Tooltip>
  );
});
