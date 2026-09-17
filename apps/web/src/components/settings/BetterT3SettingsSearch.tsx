import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "../ui/autocomplete";
import { scrollToSettingsTarget } from "./settingsLayout";
import { searchSettings, SETTINGS_SEARCH_ITEMS, type SettingsSearchItem } from "./settingsSearch";

/** Index the mounted labels so environment-specific and translated settings stay in sync. */
export function readBetterT3SettingsSearchItems(page: ParentNode): SettingsSearchItem[] {
  return Array.from(
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
    const aliases = SETTINGS_SEARCH_ITEMS.filter(
      (item) => ("targetId" in item ? item.targetId : item.id) === target.id,
    );
    return [
      {
        id: `${target.id}:${index}`,
        title,
        to: "/settings/better-t3" as const,
        targetId: target.id,
        category,
        description,
        searchTerms: aliases.flatMap((item) => [
          item.title,
          ...("searchTerms" in item ? item.searchTerms : []),
        ]),
      },
    ];
  });
}

export function BetterT3SettingsSearch() {
  const translate = useInterfaceTranslator().message;
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightedItemRef = useRef<SettingsSearchItem | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SettingsSearchItem[]>([]);
  const results = query.trim() ? searchSettings(query, items) : [];
  const label = translate("settings.application.search.aria");
  const refreshItems = () => {
    const page = inputRef.current?.closest("[data-settings-page-scroll]");
    setItems(page ? readBetterT3SettingsSearchItems(page) : []);
  };
  const selectSearchResult = (item: SettingsSearchItem) => {
    highlightedItemRef.current = null;
    setOpen(false);
    setQuery("");
    window.requestAnimationFrame(() => scrollToSettingsTarget(item.targetId ?? item.id));
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
      <AutocompleteInput
        ref={inputRef}
        aria-label={label}
        className="h-10 items-center rounded-lg border-border/60 bg-background/50 shadow-none hover:bg-background/70 focus-within:bg-background [&_input]:h-full [&_input]:ps-9 [&_input]:pe-9 [&_input]:py-0 [&_input]:leading-normal"
        onFocus={() => {
          refreshItems();
          if (query.trim()) setOpen(true);
        }}
        placeholder={label}
        showClear={query.length > 0}
        spellCheck={false}
        startAddon={<SearchIcon className="size-4 text-icon-muted" />}
      />
      {query.trim() ? (
        <AutocompletePopup aria-label={label} className="w-(--anchor-width) overflow-hidden">
          {results.length > 0 ? (
            <AutocompleteList
              aria-label={translate("settings.application.search.resultsAria")}
              className="max-h-72"
            >
              {results.map((item) => (
                <AutocompleteItem key={item.id} value={item} className="items-start py-2">
                  <span className="min-w-0">
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
            <AutocompleteEmpty className="p-6">
              {translate("settings.application.search.empty")}
            </AutocompleteEmpty>
          )}
        </AutocompletePopup>
      ) : null}
    </Autocomplete>
  );
}
