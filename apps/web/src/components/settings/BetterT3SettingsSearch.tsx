import { SearchIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandDialogTrigger,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "../ui/command";
import { DialogClose } from "../ui/dialog";
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
    const category = element.closest('[role="region"]')?.querySelector("h2")?.textContent ?? "";
    const description =
      element.dataset.slot === "settings-row"
        ? (element.querySelector(":scope > div > div > p")?.textContent ?? "")
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
        searchTerms: [
          category,
          description,
          ...aliases.flatMap((item) => [
            item.title,
            ...("searchTerms" in item ? item.searchTerms : []),
          ]),
        ],
      },
    ];
  });
}

export function BetterT3SettingsSearch() {
  const translate = useInterfaceTranslator().message;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedTargetRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SettingsSearchItem[]>([]);
  const results = query.trim() ? searchSettings(query, items) : items;
  const label = translate("settings.application.search.aria");

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) {
          const page = triggerRef.current?.closest("[data-settings-page-scroll]");
          setItems(page ? readBetterT3SettingsSearchItems(page) : []);
          setQuery("");
          selectedTargetRef.current = null;
        }
        if (details.reason === "escape-key") details.event.preventDefault();
        setOpen(nextOpen);
      }}
    >
      <CommandDialogTrigger
        ref={triggerRef}
        render={<Button size="sm" variant="outline" className="shrink-0" />}
        aria-label={label}
      >
        <SearchIcon className="size-3.5" />
        {translate("settings.application.search.placeholder")}
      </CommandDialogTrigger>
      <CommandDialogPopup
        aria-label={label}
        className="overflow-hidden p-0"
        finalFocus={() => {
          const targetId = selectedTargetRef.current;
          selectedTargetRef.current = null;
          return !(targetId && scrollToSettingsTarget(targetId));
        }}
      >
        <Command items={results} mode="none" value={query} onValueChange={setQuery}>
          <div className="flex items-center pe-2">
            <CommandInput
              aria-label={label}
              placeholder={label}
              wrapperClassName="min-w-0 flex-1"
            />
            <DialogClose
              render={<Button size="icon-sm" variant="ghost" />}
              aria-label={translate("ui.close")}
            >
              <XIcon className="size-4" />
            </DialogClose>
          </div>
          <CommandPanel>
            {results.length > 0 ? (
              <CommandList aria-label={translate("settings.application.search.resultsAria")}>
                {results.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item}
                    onClick={() => {
                      selectedTargetRef.current = item.targetId ?? item.id;
                      setOpen(false);
                    }}
                    className="cursor-pointer py-2"
                  >
                    {item.title}
                  </CommandItem>
                ))}
              </CommandList>
            ) : (
              <p role="status" className="p-8 text-center text-sm text-muted-foreground">
                {translate("settings.application.search.empty")}
              </p>
            )}
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
