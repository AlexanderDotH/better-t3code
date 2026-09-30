import {
  DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE,
  OPENROUTER_MODEL_CONTEXT_THRESHOLDS,
  OPENROUTER_MODEL_SORT_DEFINITIONS,
  countActiveOpenRouterModelCatalogFilters,
  type OpenRouterModelCatalogFilterState,
  type OpenRouterModelCatalogView,
  type OpenRouterModelCatalogSort,
  type OpenRouterModelContextThreshold,
  type OpenRouterModelContextThresholdSelection,
  type OpenRouterModelFilter,
} from "@t3tools/shared/modelCatalogFilters";
import {
  ChevronDownIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  StarIcon,
  UsersIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { OpenRouterIcon } from "../../Icons";
import { Button } from "../../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../../ui/menu";

export interface OpenRouterCatalogFilterPanelProps {
  readonly state: OpenRouterModelCatalogFilterState;
  readonly defaultState?: OpenRouterModelCatalogFilterState;
  readonly view: Pick<
    OpenRouterModelCatalogView,
    "totalCount" | "matchingCount" | "favoriteCount" | "filterFacets" | "authorFacets"
  >;
  readonly instanceDisplayName?: string;
  readonly className?: string;
  readonly onChange: (state: OpenRouterModelCatalogFilterState) => void;
}

const QUICK_CONTEXT_THRESHOLD: OpenRouterModelContextThreshold = "128k";

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function catalogFilterStatesEqual(
  left: OpenRouterModelCatalogFilterState,
  right: OpenRouterModelCatalogFilterState,
): boolean {
  return (
    setsEqual(left.featureFilters, right.featureFilters) &&
    setsEqual(left.authors, right.authors) &&
    left.contextThreshold === right.contextThreshold &&
    left.favoritesOnly === right.favoritesOnly &&
    left.sort === right.sort
  );
}

function replaceFeatureFilter(
  state: OpenRouterModelCatalogFilterState,
  filter: OpenRouterModelFilter,
): OpenRouterModelCatalogFilterState {
  const featureFilters = new Set(state.featureFilters);
  if (!featureFilters.delete(filter)) featureFilters.add(filter);
  return { ...state, featureFilters };
}

function replaceAuthor(
  state: OpenRouterModelCatalogFilterState,
  author: string,
): OpenRouterModelCatalogFilterState {
  const authors = new Set(state.authors);
  if (!authors.delete(author)) authors.add(author);
  return { ...state, authors };
}

function contextLabel(value: OpenRouterModelContextThresholdSelection): string {
  if (value === "any") return "Any";
  return (
    OPENROUTER_MODEL_CONTEXT_THRESHOLDS.find((threshold) => threshold.id === value)?.label ?? value
  );
}

function sortLabel(value: OpenRouterModelCatalogSort): string {
  return OPENROUTER_MODEL_SORT_DEFINITIONS.find((sort) => sort.id === value)?.label ?? value;
}

function CatalogFilterButton({
  active = false,
  appearance = "toggle",
  className,
  ...props
}: ComponentProps<"button"> & {
  readonly active?: boolean;
  readonly appearance?: "toggle" | "facet" | "reset" | "favorite";
}) {
  return (
    <button
      type="button"
      className={cn(
        "relative inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-md border border-transparent px-2 text-3xs font-medium text-muted-foreground outline-none transition-[box-shadow,scale] [&:active:not([aria-haspopup])]:scale-97 [&_svg]:-mx-0.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 pointer-coarse:h-11 pointer-coarse:px-3",
        appearance === "reset"
          ? "px-1.5 hover:bg-accent hover:text-foreground"
          : "hover:border-border/60 hover:bg-background/60 hover:text-foreground",
        active &&
          (appearance === "reset"
            ? "bg-foreground/[0.045] text-foreground"
            : "border-border/70 bg-background text-foreground"),
        active && appearance === "toggle" && "shadow-xs shadow-foreground/8",
        active && appearance === "facet" && "shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

function FilterToggle(props: {
  readonly label: string;
  readonly count: number;
  readonly pressed: boolean;
  readonly onPressedChange: () => void;
}) {
  return (
    <CatalogFilterButton
      active={props.pressed}
      aria-label={props.label}
      aria-pressed={props.pressed}
      onClick={props.onPressedChange}
    >
      {props.label}
      <span className="rounded-catalog-chip bg-foreground/[0.055] px-1 py-px tabular-nums opacity-65">
        {props.count.toLocaleString()}
      </span>
    </CatalogFilterButton>
  );
}

function FacetMenuTrigger(props: {
  readonly label: string;
  readonly active?: boolean;
  readonly icon?: ReactNode;
}) {
  return (
    <MenuTrigger
      render={<CatalogFilterButton active={props.active ?? false} appearance="facet" />}
      aria-label={props.label}
    >
      {props.icon}
      <span>{props.label}</span>
      <ChevronDownIcon className="size-2.5 opacity-60" />
    </MenuTrigger>
  );
}

export function OpenRouterCatalogFilterPanel(props: OpenRouterCatalogFilterPanelProps) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const defaultState = props.defaultState ?? DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE;
  const activeFilterCount = countActiveOpenRouterModelCatalogFilters(props.state);
  const isDefaultState = catalogFilterStatesEqual(props.state, defaultState);
  const selectedAuthorCount = props.state.authors.size;
  const quickContextSelected = props.state.contextThreshold === QUICK_CONTEXT_THRESHOLD;
  const quickContextFacet = props.view.filterFacets.find((facet) => facet.id === "128k");
  const featureFacets = props.view.filterFacets.filter((facet) => facet.id !== "128k");
  const instanceDisplayName = props.instanceDisplayName?.trim() || "OpenRouter";

  return (
    <section
      aria-label={translate("chat.catalog.label")}
      className={cn(
        "border-border/70 border-b bg-gradient-to-b from-background/45 to-transparent px-2 pb-2 pt-1.5",
        props.className,
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape") event.stopPropagation();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-2 px-0.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/80 shadow-xs">
          <OpenRouterIcon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-2xs font-semibold">{instanceDisplayName}</span>
            <span className="shrink-0 rounded-catalog-chip bg-foreground/[0.055] px-1 py-0.5 text-catalog-tag font-medium uppercase tracking-catalog-tag text-muted-foreground">
              {translate("chat.catalog.badge")}
            </span>
          </span>
          <span
            className="mt-0.5 block text-3xs leading-none tabular-nums text-muted-foreground/75"
            aria-live="polite"
          >
            {translate("chat.catalog.modelCount", {
              count: props.view.matchingCount,
              matching: translator.number(props.view.matchingCount),
              total: translator.number(props.view.totalCount),
            })}
          </span>
        </span>
        <CatalogFilterButton
          active={!isDefaultState}
          appearance="reset"
          disabled={isDefaultState}
          aria-label={translate("chat.catalog.resetFilters")}
          onClick={() => props.onChange(defaultState)}
        >
          <RotateCcwIcon className="size-3" />
          <span>{translate("chat.catalog.reset")}</span>
          {!isDefaultState && activeFilterCount > 0 ? (
            <span className="tabular-nums opacity-60">{activeFilterCount}</span>
          ) : null}
        </CatalogFilterButton>
      </div>

      <div className="mt-2 min-w-0 space-y-1.5">
        <div
          role="group"
          className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={translate("chat.catalog.filters")}
        >
          {featureFacets.map((filter) => (
            <FilterToggle
              key={filter.id}
              label={filter.label}
              count={filter.count}
              pressed={props.state.featureFilters.has(filter.id)}
              onPressedChange={() => props.onChange(replaceFeatureFilter(props.state, filter.id))}
            />
          ))}
          <FilterToggle
            label={translate("chat.catalog.quickContext")}
            count={quickContextFacet?.count ?? 0}
            pressed={quickContextSelected}
            onPressedChange={() =>
              props.onChange({
                ...props.state,
                contextThreshold: quickContextSelected ? "any" : QUICK_CONTEXT_THRESHOLD,
              })
            }
          />
        </div>

        <div
          className="flex min-w-0 items-center gap-1 overflow-x-auto border-border/45 border-t pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label={translate("chat.catalog.refinement")}
        >
          <Menu>
            <FacetMenuTrigger
              label={translate("chat.catalog.contextPrefix", {
                label: contextLabel(props.state.contextThreshold),
              })}
              active={props.state.contextThreshold !== "any"}
              icon={<SlidersHorizontalIcon className="size-3" />}
            />
            <MenuPopup align="start" side="bottom" className="min-w-40">
              <MenuGroup>
                <MenuGroupLabel>{translate("chat.catalog.minimumContext")}</MenuGroupLabel>
                <MenuRadioGroup
                  value={props.state.contextThreshold}
                  onValueChange={(contextThreshold) =>
                    props.onChange({
                      ...props.state,
                      contextThreshold:
                        contextThreshold as OpenRouterModelContextThresholdSelection,
                    })
                  }
                >
                  <MenuRadioItem value="any">{translate("chat.catalog.anyContext")}</MenuRadioItem>
                  {OPENROUTER_MODEL_CONTEXT_THRESHOLDS.map((threshold) => (
                    <MenuRadioItem key={threshold.id} value={threshold.id}>
                      {threshold.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
            </MenuPopup>
          </Menu>

          {props.view.authorFacets.length > 1 ? (
            <Menu>
              <FacetMenuTrigger
                label={
                  selectedAuthorCount > 0
                    ? translate("chat.catalog.creatorsCount", { count: selectedAuthorCount })
                    : translate("chat.catalog.creators")
                }
                active={selectedAuthorCount > 0}
                icon={<UsersIcon className="size-3" />}
              />
              <MenuPopup align="start" side="bottom" className="max-h-72 min-w-48">
                <MenuGroup>
                  <MenuGroupLabel>{translate("chat.catalog.modelCreators")}</MenuGroupLabel>
                  {props.view.authorFacets.map((author) => (
                    <MenuCheckboxItem
                      key={author.id}
                      checked={props.state.authors.has(author.id)}
                      closeOnClick={false}
                      onCheckedChange={() => props.onChange(replaceAuthor(props.state, author.id))}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="min-w-0 flex-1 truncate">{author.label}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {author.count.toLocaleString()}
                        </span>
                      </span>
                    </MenuCheckboxItem>
                  ))}
                </MenuGroup>
                {selectedAuthorCount > 0 ? (
                  <>
                    <MenuSeparator />
                    <Button
                      variant="ghost-muted"
                      size="xs"
                      className="w-full justify-start pointer-coarse:h-11"
                      onClick={() => props.onChange({ ...props.state, authors: new Set() })}
                    >
                      {translate("chat.catalog.clearCreators")}
                    </Button>
                  </>
                ) : null}
              </MenuPopup>
            </Menu>
          ) : null}

          {props.view.favoriteCount > 0 ? (
            <CatalogFilterButton
              active={props.state.favoritesOnly}
              appearance="favorite"
              aria-label={translate("chat.composer.favorites")}
              aria-pressed={props.state.favoritesOnly}
              onClick={() =>
                props.onChange({ ...props.state, favoritesOnly: !props.state.favoritesOnly })
              }
            >
              <StarIcon
                className={cn("size-3", props.state.favoritesOnly && "fill-current text-warning")}
              />
              {props.view.favoriteCount.toLocaleString()}
            </CatalogFilterButton>
          ) : null}

          <Menu>
            <FacetMenuTrigger
              label={translate("chat.catalog.sortPrefix", {
                label: sortLabel(props.state.sort),
              })}
              active={props.state.sort !== defaultState.sort}
            />
            <MenuPopup align="end" side="bottom" className="min-w-40">
              <MenuGroup>
                <MenuGroupLabel>{translate("chat.catalog.sortModels")}</MenuGroupLabel>
                <MenuRadioGroup
                  value={props.state.sort}
                  onValueChange={(sort) =>
                    props.onChange({ ...props.state, sort: sort as OpenRouterModelCatalogSort })
                  }
                >
                  {OPENROUTER_MODEL_SORT_DEFINITIONS.map((sort) => (
                    <MenuRadioItem key={sort.id} value={sort.id}>
                      {sort.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
            </MenuPopup>
          </Menu>
        </div>
      </div>
    </section>
  );
}
