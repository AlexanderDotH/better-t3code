import { formatModelContextWindowTokens } from "@t3tools/shared/model";
import {
  matchesOpenRouterModelFilters,
  type OpenRouterModelFilter,
} from "@t3tools/shared/modelCatalogFilters";
import type { ModelEsque } from "./providerIconUtils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { type ProviderDriverKind, type ProviderInstanceId } from "@t3tools/contracts";

import { memo } from "react";
import { CheckIcon, StarIcon } from "lucide-react";
import { getDisplayModelName } from "./providerIconUtils";
import { ComboboxItem } from "../ui/combobox";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { modelPickerModelKey } from "./modelPickerKeys";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

export const ModelListRow = memo(function ModelListRow(props: {
  index: number;
  layout?: "current" | "classic";
  model?: ModelEsque;
  presentation?: "compact" | "catalog";
  slug: string;
  name: string;
  subProvider?: string | undefined;
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  providerDisplayName: string;
  providerAccentColor?: string | undefined;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
  isFavorite: boolean;
  /** In Favorites every row is starred, so the star shows only on hover. */
  favoriteStarOnHover?: boolean;
  isSelected: boolean;
  /** Marks this instance apart from another of the same provider. */
  showInstanceBadge: boolean;
  showNewBadge?: boolean;
  decisionSupport?: "native" | "prompted" | undefined;
  unavailable?: boolean;
  jumpLabel?: string | null;
  disabledReason?: string | null;
  onToggleFavorite: (instanceId: ProviderInstanceId, slug: string) => void;
}) {
  const classic = props.layout === "classic";
  const model = props.model ?? {
    slug: props.slug,
    name: props.name,
    subProvider: props.subProvider,
  };
  const providerLabel = props.subProvider
    ? `${props.providerDisplayName} · ${props.subProvider}`
    : props.providerDisplayName;
  const providerIcon = (
    <ProviderInstanceIcon
      driverKind={props.driverKind}
      displayName={props.providerDisplayName}
      accentColor={props.providerAccentColor}
      acpRegistryAgentId={props.acpRegistryAgentId}
      acpRegistryIconUrl={props.acpRegistryIconUrl}
      showBadge={props.showInstanceBadge}
      className={classic ? "size-3 shrink-0" : "size-4"}
      iconClassName={classic ? "size-3" : "size-4"}
      indicatorBackground="var(--popover)"
      badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
    />
  );

  const row = (
    <ComboboxItem
      hideIndicator
      selectedFill={classic}
      index={props.index}
      value={modelPickerModelKey(props.instanceId, props.slug)}
      disabled={Boolean(props.disabledReason)}
      className={cn(
        "group relative w-full !min-w-0 max-w-full cursor-pointer",
        props.disabledReason &&
          "data-disabled:pointer-events-auto data-disabled:cursor-not-allowed",
      )}
    >
      {classic ? null : providerIcon}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-left">
          <div
            className={cn(
              "min-w-0 truncate leading-snug",
              classic ? "text-xs font-medium" : "text-sm font-normal",
            )}
            // Names the row in full on hover only when it is cut off.
            onPointerEnter={(event) => {
              const name = event.currentTarget;
              name.title = name.scrollWidth > name.clientWidth ? getDisplayModelName(model) : "";
            }}
          >
            {getDisplayModelName(model)}
            {/* The logo is decorative, so name the provider for screen readers. */}
            {classic ? null : <span className="sr-only">, {props.providerDisplayName}</span>}
          </div>
          {props.subProvider && !classic ? (
            <span className="min-w-0 shrink truncate text-xs text-muted-foreground/70">
              {props.subProvider}
            </span>
          ) : null}
          {props.showNewBadge ? (
            <span
              className="shrink-0 rounded border border-update/35 bg-update/15 px-0.5 py-px text-3xs font-bold uppercase leading-none tracking-wide text-update-foreground"
              aria-label="New model"
            >
              New
            </span>
          ) : null}
          {props.decisionSupport ? (
            <Badge variant="outline" size="sm">
              {props.decisionSupport === "native" ? "Native decisions" : "Prompted decisions"}
            </Badge>
          ) : null}
          {props.unavailable ? (
            <Badge variant="outline" size="sm">
              Unavailable
            </Badge>
          ) : null}
        </div>

        {props.presentation === "catalog" ? (
          <ModelCatalogMetadata model={model} providerLabel={props.providerDisplayName} />
        ) : classic ? (
          <div className="mt-1 flex items-center gap-1.5">
            {providerIcon}
            <span className="truncate text-xs font-normal leading-snug text-muted-foreground/70">
              {providerLabel}
            </span>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {props.jumpLabel ? <Kbd>{props.jumpLabel}</Kbd> : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                className="-mr-1 shrink-0"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleFavorite(props.instanceId, props.slug);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
                disabled={Boolean(props.disabledReason)}
                aria-label={props.isFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <StarIcon
                  className={cn(
                    "size-3.5 sm:size-3",
                    props.isFavorite && "fill-current text-warning",
                    !classic &&
                      (!props.isFavorite || props.favoriteStarOnHover) &&
                      "opacity-0 group-hover:opacity-100 group-data-highlighted:opacity-100 in-focus-visible:opacity-100 pointer-coarse:opacity-100",
                  )}
                />
              </Button>
            }
          />
          <TooltipPopup side="top" align="center">
            {props.isFavorite ? "Remove from favorites" : "Add to favorites"}
          </TooltipPopup>
        </Tooltip>
        {/* Last, and always reserved, so stars and the check keep fixed columns. */}
        <CheckIcon
          className={cn("size-3.5", !props.isSelected && "invisible")}
          aria-hidden="true"
        />
      </div>
    </ComboboxItem>
  );

  if (!props.disabledReason) {
    return row;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipPopup side="left" align="center">
        {props.disabledReason}
      </TooltipPopup>
    </Tooltip>
  );
});

const FREE_MODEL_FILTER = new Set<OpenRouterModelFilter>(["free"]);

const VISION_MODEL_FILTER = new Set<OpenRouterModelFilter>(["vision"]);

const REASONING_MODEL_FILTER = new Set<OpenRouterModelFilter>(["reasoning"]);

export function ModelCatalogMetadata(props: {
  readonly model: ModelEsque;
  readonly providerLabel: string;
}) {
  const translate = useInterfaceTranslator().message;
  const contextTokens = props.model.capabilities?.contextWindow?.maxTokens;
  const isFree = matchesOpenRouterModelFilters(props.model, FREE_MODEL_FILTER);
  const supportsVision = matchesOpenRouterModelFilters(props.model, VISION_MODEL_FILTER);
  const supportsReasoning = matchesOpenRouterModelFilters(props.model, REASONING_MODEL_FILTER);
  const hasFeatureBadges = isFree || supportsVision || supportsReasoning;

  return (
    <div
      className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-3xs leading-none text-muted-foreground/70"
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
            {translate("chat.model.context", {
              tokens: formatModelContextWindowTokens(contextTokens),
            })}
          </span>
        </>
      ) : null}
      {hasFeatureBadges ? (
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          {isFree ? (
            <span className="shrink-0 rounded-catalog-chip bg-success/10 px-1 py-0.5 font-medium text-success-foreground">
              {translate("chat.model.free")}
            </span>
          ) : null}
          {supportsVision ? (
            <span className="shrink-0 rounded-catalog-chip bg-foreground/[0.045] px-1 py-0.5">
              {translate("chat.model.vision")}
            </span>
          ) : null}
          {supportsReasoning ? (
            <span className="shrink-0 rounded-catalog-chip bg-foreground/[0.045] px-1 py-0.5">
              {translate("chat.model.reasoning")}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
