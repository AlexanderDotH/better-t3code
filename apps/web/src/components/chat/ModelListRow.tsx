import { type ProviderDriverKind, type ProviderInstanceId } from "@t3tools/contracts";
import { formatModelContextWindowTokens } from "@t3tools/shared/model";
import {
  matchesOpenRouterModelFilters,
  type OpenRouterModelFilter,
} from "@t3tools/shared/modelCatalogFilters";
import { memo } from "react";
import { CheckIcon, StarIcon } from "lucide-react";
import {
  getDisplayModelName,
  getTriggerDisplayModelLabel,
  type ModelEsque,
  PROVIDER_ICON_BY_PROVIDER,
} from "./providerIconUtils";
import { ComboboxItem } from "../ui/combobox";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { modelPickerModelKey } from "./modelPickerKeys";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

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
  showSelection?: boolean;
  showProvider: boolean;
  preferShortName?: boolean;
  useTriggerLabel?: boolean;
  showNewBadge?: boolean;
  decisionSupport?: "native" | "prompted";
  unavailable?: boolean;
  jumpLabel?: string | null;
  disabledReason?: string | null;
  presentation?: "compact" | "catalog";
  onToggleFavorite: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.driverKind] ?? null;
  const providerLabel = props.model.subProvider
    ? props.presentation === "catalog"
      ? props.model.subProvider
      : `${props.providerDisplayName} · ${props.model.subProvider}`
    : props.providerDisplayName;

  const row = (
    <ComboboxItem
      hideIndicator
      index={props.index}
      value={modelPickerModelKey(props.instanceId, props.model.slug)}
      disabled={Boolean(props.disabledReason)}
      className={cn(
        "group relative w-full !min-w-0 max-w-full cursor-pointer",
        props.disabledReason &&
          "data-disabled:pointer-events-auto data-disabled:cursor-not-allowed",
      )}
    >
      <div className="min-w-0 flex-1 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 truncate text-xs font-medium leading-snug">
            {props.useTriggerLabel
              ? getTriggerDisplayModelLabel(props.model)
              : getDisplayModelName(
                  props.model,
                  props.preferShortName ? { preferShortName: true } : undefined,
                )}
          </div>
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
              {translate(`chat.model.decision.${props.decisionSupport}`)}
            </Badge>
          ) : null}
          {props.unavailable ? (
            <Badge variant="outline" size="sm">
              Unavailable
            </Badge>
          ) : null}
        </div>
        {props.presentation === "catalog" ? (
          <ModelCatalogMetadata model={props.model} providerLabel={providerLabel} />
        ) : props.showProvider ? (
          <div className="mt-1 flex items-center gap-1.5">
            {ProviderIcon ? <ProviderIcon className="size-3 shrink-0" /> : null}
            <span className="truncate text-xs font-normal leading-snug text-muted-foreground/70">
              {providerLabel}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {props.showSelection && props.isSelected ? (
          <CheckIcon className="size-3.5" aria-hidden="true" />
        ) : null}
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
                  props.onToggleFavorite();
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
                  )}
                />
              </Button>
            }
          />
          <TooltipPopup side="top" align="center">
            {props.isFavorite ? "Remove from favorites" : "Add to favorites"}
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
      <TooltipPopup side="left" align="center">
        {props.disabledReason}
      </TooltipPopup>
    </Tooltip>
  );
});
