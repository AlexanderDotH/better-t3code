import {
  DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE,
  OPENROUTER_MODEL_CONTEXT_THRESHOLDS,
  OPENROUTER_MODEL_SORT_DEFINITIONS,
  countActiveOpenRouterModelCatalogFilters,
  isDefaultOpenRouterModelCatalogFilterState,
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
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
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
  readonly view: Pick<
    OpenRouterModelCatalogView,
    "totalCount" | "matchingCount" | "favoriteCount" | "filterFacets" | "authorFacets"
  >;
  readonly instanceDisplayName?: string;
  readonly className?: string;
  readonly onChange: (state: OpenRouterModelCatalogFilterState) => void;
}

const QUICK_CONTEXT_THRESHOLD: OpenRouterModelContextThreshold = "128k";

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

function FilterToggle(props: {
  readonly label: string;
  readonly count: number;
  readonly pressed: boolean;
  readonly onPressedChange: () => void;
}) {
  return (
    <Button
      size="micro"
      variant={props.pressed ? "secondary" : "ghost-muted"}
      className={cn(
        "h-6 rounded-md border border-transparent px-2 text-[10px] shadow-none pointer-coarse:h-11 pointer-coarse:px-3",
        "hover:border-border/60 hover:bg-background/60",
        props.pressed &&
          "border-border/70 bg-background text-foreground shadow-[0_1px_2px_color-mix(in_srgb,var(--foreground)_8%,transparent)]",
      )}
      aria-label={props.label}
      aria-pressed={props.pressed}
      onClick={props.onPressedChange}
    >
      {props.label}
      <span className="rounded-[4px] bg-foreground/[0.055] px-1 py-px tabular-nums opacity-65">
        {props.count.toLocaleString()}
      </span>
    </Button>
  );
}

function FacetMenuTrigger(props: {
  readonly label: string;
  readonly active?: boolean;
  readonly icon?: ReactNode;
}) {
  return (
    <MenuTrigger
      render={
        <Button
          size="micro"
          variant={props.active ? "secondary" : "ghost-muted"}
          className={cn(
            "h-6 rounded-md border border-transparent px-2 text-[10px] shadow-none pointer-coarse:h-11 pointer-coarse:px-3",
            "hover:border-border/60 hover:bg-background/60",
            props.active && "border-border/70 bg-background text-foreground shadow-xs",
          )}
        />
      }
      aria-label={props.label}
    >
      {props.icon}
      <span>{props.label}</span>
      <ChevronDownIcon className="size-2.5 opacity-60" />
    </MenuTrigger>
  );
}

export function OpenRouterCatalogFilterPanel(props: OpenRouterCatalogFilterPanelProps) {
  const activeFilterCount = countActiveOpenRouterModelCatalogFilters(props.state);
  const isDefaultState = isDefaultOpenRouterModelCatalogFilterState(props.state);
  const selectedAuthorCount = props.state.authors.size;
  const quickContextSelected = props.state.contextThreshold === QUICK_CONTEXT_THRESHOLD;
  const quickContextFacet = props.view.filterFacets.find((facet) => facet.id === "128k");
  const featureFacets = props.view.filterFacets.filter((facet) => facet.id !== "128k");
  const instanceDisplayName = props.instanceDisplayName?.trim() || "OpenRouter";

  return (
    <section
      aria-label="OpenRouter model catalog"
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
            <span className="truncate text-[11px] font-semibold">{instanceDisplayName}</span>
            <span className="shrink-0 rounded-[4px] bg-foreground/[0.055] px-1 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Catalog
            </span>
          </span>
          <span
            className="mt-0.5 block text-[10px] leading-none tabular-nums text-muted-foreground/75"
            aria-live="polite"
          >
            {props.view.matchingCount.toLocaleString()} of {props.view.totalCount.toLocaleString()}{" "}
            models
          </span>
        </span>
        <Button
          size="micro"
          variant="ghost-muted"
          className={cn(
            "h-6 rounded-md px-1.5 text-[10px] pointer-coarse:h-11 pointer-coarse:px-3",
            !isDefaultState && "bg-foreground/[0.045] text-foreground",
          )}
          disabled={isDefaultState}
          aria-label="Reset filters"
          onClick={() => props.onChange(DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE)}
        >
          <RotateCcwIcon className="size-3" />
          <span>Reset</span>
          {!isDefaultState && activeFilterCount > 0 ? (
            <span className="tabular-nums opacity-60">{activeFilterCount}</span>
          ) : null}
        </Button>
      </div>

      <div className="mt-2 min-w-0 space-y-1.5">
        <div
          role="group"
          className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Catalog filters"
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
            label="128K+"
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
          aria-label="Catalog refinement"
        >
          <Menu>
            <FacetMenuTrigger
              label={`Context: ${contextLabel(props.state.contextThreshold)}`}
              active={props.state.contextThreshold !== "any"}
              icon={<SlidersHorizontalIcon className="size-3" />}
            />
            <MenuPopup align="start" side="bottom" className="min-w-40">
              <MenuGroup>
                <MenuGroupLabel>Minimum context</MenuGroupLabel>
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
                  <MenuRadioItem value="any">Any context</MenuRadioItem>
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
                label={selectedAuthorCount > 0 ? `Creators (${selectedAuthorCount})` : "Creators"}
                active={selectedAuthorCount > 0}
                icon={<UsersIcon className="size-3" />}
              />
              <MenuPopup align="start" side="bottom" className="max-h-72 min-w-48">
                <MenuGroup>
                  <MenuGroupLabel>Model creators</MenuGroupLabel>
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
                      Clear creators
                    </Button>
                  </>
                ) : null}
              </MenuPopup>
            </Menu>
          ) : null}

          {props.view.favoriteCount > 0 ? (
            <Button
              size="micro"
              variant={props.state.favoritesOnly ? "secondary" : "ghost-muted"}
              className={cn(
                "h-6 rounded-md border border-transparent px-2 text-[10px] shadow-none pointer-coarse:h-11 pointer-coarse:px-3",
                "hover:border-border/60 hover:bg-background/60",
                props.state.favoritesOnly && "border-border/70 bg-background text-foreground",
              )}
              aria-label="Favorites"
              aria-pressed={props.state.favoritesOnly}
              onClick={() =>
                props.onChange({ ...props.state, favoritesOnly: !props.state.favoritesOnly })
              }
            >
              <StarIcon
                className={cn(
                  "size-3",
                  props.state.favoritesOnly && "fill-current text-yellow-500",
                )}
              />
              {props.view.favoriteCount.toLocaleString()}
            </Button>
          ) : null}

          <Menu>
            <FacetMenuTrigger
              label={`Sort: ${sortLabel(props.state.sort)}`}
              active={props.state.sort !== DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE.sort}
            />
            <MenuPopup align="end" side="bottom" className="min-w-40">
              <MenuGroup>
                <MenuGroupLabel>Sort models</MenuGroupLabel>
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
