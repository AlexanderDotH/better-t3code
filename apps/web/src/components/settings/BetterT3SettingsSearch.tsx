import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { SearchIcon, XIcon } from "lucide-react";
import { CHAT_VISUAL_MODES, type BetterT3FeatureControlStateV1 } from "@t3tools/contracts";
import { getBetterT3SettingsSubgroupForFeature } from "@t3tools/client-runtime/better-t3-settings-layout";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "../ui/autocomplete";
import { useRequestSettingsSearchTarget } from "./settingsLayout";
import { resolveBetterT3DescriptorMessageKeys } from "./BetterT3SettingsPanel.logic";
import { searchSettings, SETTINGS_SEARCH_ITEMS, type SettingsSearchItem } from "./settingsSearch";

const EMPTY_SEARCH_ITEMS: readonly SettingsSearchItem[] = [];
const BetterT3SearchItemsContext = createContext<readonly SettingsSearchItem[]>(EMPTY_SEARCH_ITEMS);
const BetterT3SearchRegistrationContext = createContext<
  (id: string, items: readonly SettingsSearchItem[]) => () => void
>(() => () => undefined);

function withSearchAliases(item: SettingsSearchItem): SettingsSearchItem {
  const targetId = item.targetId ?? item.id;
  const aliases = SETTINGS_SEARCH_ITEMS.filter(
    (alias) => ("targetId" in alias ? alias.targetId : alias.id) === targetId,
  );
  return {
    ...item,
    searchTerms: [
      ...(item.searchTerms ?? []),
      ...aliases.flatMap((alias) => [
        alias.title,
        ...("searchTerms" in alias ? alias.searchTerms : []),
      ]),
    ],
  };
}

/** Declare only rows rendered by the current surface, even before their lazy content mounts. */
export function buildBetterT3FeatureSearchItems(
  features: readonly BetterT3FeatureControlStateV1[],
  translate: InterfaceTranslator["message"],
): SettingsSearchItem[] {
  return features.flatMap((feature) => {
    const subgroup = getBetterT3SettingsSubgroupForFeature(feature.descriptor.id);
    if (!subgroup) return [];
    const messageIds = resolveBetterT3DescriptorMessageKeys(feature.descriptor);
    return [
      {
        id: feature.descriptor.id,
        targetId: feature.descriptor.id,
        to: "/settings/better-t3" as const,
        title: translate(messageIds.labelMessageId),
        description: translate(messageIds.descriptionMessageId),
        category: translate(`settings.betterT3.tab.${subgroup.categoryId}`),
        searchTerms: [
          translate(subgroup.titleMessageId),
          ...(feature.descriptor.id === "chat.presentation"
            ? CHAT_VISUAL_MODES.map((mode) => translate(`settings.chatVisuals.${mode}`))
            : []),
        ],
      },
    ];
  });
}

export function BetterT3SettingsSearchItemsProvider({
  items = EMPTY_SEARCH_ITEMS,
  children,
}: {
  readonly items?: readonly SettingsSearchItem[];
  readonly children: ReactNode;
}) {
  const [registrations, setRegistrations] = useState<
    ReadonlyMap<string, readonly SettingsSearchItem[]>
  >(new Map());
  const register = useCallback((id: string, entries: readonly SettingsSearchItem[]) => {
    setRegistrations((current) => new Map(current).set(id, entries));
    return () => {
      setRegistrations((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    };
  }, []);
  const availableItems = useMemo(
    () => [...items, ...Array.from(registrations.values()).flat()],
    [items, registrations],
  );
  return (
    <BetterT3SearchRegistrationContext value={register}>
      <BetterT3SearchItemsContext value={availableItems}>{children}</BetterT3SearchItemsContext>
    </BetterT3SearchRegistrationContext>
  );
}

/** Register specialized fields outside their collapsed body, after the usual availability checks. */
export function BetterT3SettingsSearchItems({
  items,
}: {
  readonly items: readonly SettingsSearchItem[];
}) {
  const id = useId();
  const register = useContext(BetterT3SearchRegistrationContext);
  useEffect(() => register(id, items), [id, items, register]);
  return null;
}

/** Merge declared lazy fields with current DOM labels without indexing unrelated hidden controls. */
export function readBetterT3SettingsSearchItems(
  page: ParentNode,
  declaredItems: readonly SettingsSearchItem[] = EMPTY_SEARCH_ITEMS,
): SettingsSearchItem[] {
  const mountedItems = Array.from(
    page.querySelectorAll<HTMLElement>(
      '[data-slot="settings-row"], section[id], [role="region"][id]',
    ),
  ).flatMap((element, index) => {
    const heading = element.querySelector("h2, h3");
    const title = heading?.textContent?.trim();
    const target = element.closest<HTMLElement>('[id][tabindex="-1"]');
    if (
      !title ||
      !target ||
      heading?.classList.contains("sr-only") ||
      element.closest('[hidden], [aria-hidden="true"]')
    )
      return [];
    const category =
      element.closest('[role="region"]')?.querySelector("h2")?.textContent?.trim() ?? "";
    const description =
      element.dataset.slot === "settings-row"
        ? (element.querySelector(":scope > div > div > p")?.textContent?.trim() ?? "")
        : "";
    return [
      {
        id: `${target.id}:${index}`,
        title,
        to: "/settings/better-t3" as const,
        targetId: target.id,
        category,
        description,
      },
    ];
  });
  const declaredTargets = new Set(declaredItems.map((item) => item.targetId ?? item.id));
  return [
    ...declaredItems,
    ...mountedItems.filter((item) => !declaredTargets.has(item.targetId)),
  ].map(withSearchAliases);
}

export function BetterT3SettingsSearch() {
  const translate = useInterfaceTranslator().message;
  const declaredItems = useContext(BetterT3SearchItemsContext);
  const requestTarget = useRequestSettingsSearchTarget();
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightedItemRef = useRef<SettingsSearchItem | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mountedItems, setMountedItems] = useState<SettingsSearchItem[]>([]);
  const items = useMemo(() => {
    const declaredTargets = new Set(declaredItems.map((item) => item.targetId ?? item.id));
    return [
      ...declaredItems.map(withSearchAliases),
      ...mountedItems.filter((item) => !declaredTargets.has(item.targetId ?? item.id)),
    ];
  }, [declaredItems, mountedItems]);
  const results = query.trim() ? searchSettings(query, items) : [];
  const label = translate("settings.application.search.aria");
  const refreshItems = useCallback(() => {
    const page = inputRef.current?.closest("[data-settings-page-scroll]");
    setMountedItems(page ? readBetterT3SettingsSearchItems(page) : []);
  }, []);
  useEffect(refreshItems, [declaredItems, refreshItems]);
  const selectSearchResult = (item: SettingsSearchItem) => {
    highlightedItemRef.current = null;
    setOpen(false);
    setQuery("");
    requestTarget(item.targetId ?? item.id);
  };

  return (
    <Autocomplete
      itemToStringValue={(item) => item.title}
      items={results}
      mode="none"
      onItemHighlighted={(item) => {
        highlightedItemRef.current = item ?? null;
      }}
      onOpenChange={setOpen}
      onValueChange={(value, details) => {
        if (details.reason === "item-press") {
          const selectedItem =
            highlightedItemRef.current ?? results.find((item) => item.title === value);
          if (selectedItem) selectSearchResult(selectedItem);
          return;
        }
        setQuery(value);
        setOpen(value.trim().length > 0);
      }}
      open={open && query.trim().length > 0}
      openOnInputClick
      value={query}
    >
      <div className="relative flex h-10 items-center rounded-lg border border-border/60 bg-background/50 ring-ring/24 transition-colors hover:bg-background/70 focus-within:border-ring focus-within:bg-background focus-within:ring-3">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute start-3 size-4 text-icon-muted"
        />
        <AutocompletePrimitive.Input
          ref={inputRef}
          aria-label={label}
          className="h-full w-full min-w-0 rounded-[inherit] bg-transparent ps-9 pe-9 text-sm leading-normal outline-none placeholder:text-placeholder"
          onFocus={() => {
            refreshItems();
            if (query.trim()) setOpen(true);
          }}
          placeholder={label}
          spellCheck={false}
        />
        {query.length > 0 ? (
          <AutocompletePrimitive.Clear
            aria-label={translate("settings.application.search.clearAria")}
            className="absolute end-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon aria-hidden className="size-4" />
          </AutocompletePrimitive.Clear>
        ) : null}
      </div>
      {query.trim() ? (
        <AutocompletePopup aria-label={label} className="w-(--anchor-width) overflow-hidden">
          {results.length > 0 ? (
            <AutocompleteList
              aria-label={translate("settings.application.search.resultsAria")}
              className="max-h-72"
            >
              {results.map((item) => (
                <AutocompleteItem key={item.id} value={item} className="items-start">
                  <span className="min-w-0 py-1">
                    <span className="block truncate font-medium">{item.title}</span>
                    {item.category ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.category}
                      </span>
                    ) : null}
                  </span>
                </AutocompleteItem>
              ))}
            </AutocompleteList>
          ) : (
            <AutocompleteEmpty>
              <div className="p-4">{translate("settings.application.search.empty")}</div>
            </AutocompleteEmpty>
          )}
        </AutocompletePopup>
      ) : null}
    </Autocomplete>
  );
}
