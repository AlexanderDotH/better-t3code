import {
  ExternalLinkIcon,
  PackagePlusIcon,
  PaletteIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  importOpenVsxThemeExtension,
  searchOpenVsxThemes,
  type OpenVsxThemeExtension,
  type OpenVsxThemeSort,
} from "../../openVsxThemes";
import { useDebouncedValue } from "../../state/queries";
import {
  getCustomThemes,
  getStoredCustomThemeCollection,
  replaceCustomThemeCollection,
  type ThemeDefinition,
} from "../../themePalette";
import { GitHubIcon, GitLabIcon } from "../Icons";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";

const SUGGESTED_SEARCHES = ["Dracula", "Catppuccin", "Nord", "Tokyo Night"];
const SORT_OPTIONS: ReadonlyArray<{
  value: OpenVsxThemeSort;
  messageId: InterfaceMessageKey;
}> = [
  { value: "downloadCount", messageId: "settings.theme.search.sort.downloads" },
  { value: "rating", messageId: "settings.theme.search.sort.rating" },
  { value: "timestamp", messageId: "settings.theme.search.sort.newest" },
  { value: "relevance", messageId: "settings.theme.search.sort.relevance" },
];
const SEARCH_DEBOUNCE_MS = 350;

function SourceLinkIcon({ url }: { url: string }) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "github.com" || host.endsWith(".github.com"))
      return <GitHubIcon className="size-3.5" />;
    if (host === "gitlab.com" || host.endsWith(".gitlab.com"))
      return <GitLabIcon className="size-3.5" monochrome />;
  } catch {
    // Fall through to the generic external-link icon.
  }
  return <ExternalLinkIcon className="size-3.5" />;
}

function ThemeExtensionIcon({ extension }: { extension: OpenVsxThemeExtension }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
      {extension.iconUrl && !failed ? (
        <img
          alt=""
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={extension.iconUrl}
          onError={() => setFailed(true)}
        />
      ) : (
        <PaletteIcon className="size-4" />
      )}
    </div>
  );
}

export function ThemeSearchSection({
  open,
  onInstalled,
}: {
  open: boolean;
  onInstalled: (themes: ReadonlyArray<ThemeDefinition>, context: { updated: boolean }) => void;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<OpenVsxThemeSort>("downloadCount");
  const [results, setResults] = useState<ReadonlyArray<OpenVsxThemeExtension> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<OpenVsxThemeExtension | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  // The (query, sort) pair the last search actually ran, so an install
  // finishing can tell a same-key rerun (which must not wipe an install
  // error) from a query that changed mid-install (which must be searched).
  const lastSearchKeyRef = useRef<string | null>(null);
  // The (query, sort) pair from the previous effect run, so a search error
  // that belongs to an older key can be cleared when the user returns to
  // already-shown results without clearing a fresh install error.
  const prevSearchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    if (open) {
      lastSearchKeyRef.current = null;
      prevSearchKeyRef.current = null;
      setQuery("");
      setSortBy("downloadCount");
      setResults(null);
      setError(null);
      setIsSearching(false);
      setInstallingId(null);
      setPendingUpdate(null);
    }
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [open]);

  const runSearch = useCallback(
    async (searchText: string, nextSort = sortBy) => {
      const trimmed = searchText.trim();
      if (!trimmed) return;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setError(null);
      setIsSearching(true);
      try {
        const nextResults = await searchOpenVsxThemes(trimmed, {
          signal: controller.signal,
          sortBy: nextSort,
        });
        if (!controller.signal.aborted) {
          setResults(nextResults);
          lastSearchKeyRef.current = `${trimmed}\u0000${nextSort}`;
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setResults(null);
          lastSearchKeyRef.current = null;
          setError(cause instanceof Error ? cause.message : "Open VSX search failed.");
        }
      }
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsSearching(false);
      }
    },
    [sortBy],
  );

  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (query.trim() || installingId !== null) return;
    requestRef.current?.abort();
    requestRef.current = null;
    lastSearchKeyRef.current = null;
    setResults(null);
    setError(null);
    setIsSearching(false);
  }, [query, installingId]);

  useEffect(() => {
    if (!open) return;
    const searchKey = `${debouncedQuery}\u0000${sortBy}`;
    const keyChanged = prevSearchKeyRef.current !== searchKey;
    prevSearchKeyRef.current = searchKey;
    if (installingId !== null) return;
    if (!debouncedQuery) {
      lastSearchKeyRef.current = null;
      requestRef.current?.abort();
      requestRef.current = null;
      setResults(null);
      setError(null);
      setIsSearching(false);
      return;
    }
    if (debouncedQuery !== query.trim()) {
      // The debounced value still trails the input (dialog reopened with the
      // box reset, or the user is mid-keystroke). Searching it would hit Open
      // VSX for a query that is no longer visible; wait for the debounce to
      // catch up to the current input instead.
      return;
    }
    if (lastSearchKeyRef.current === searchKey) {
      // The results already match this query. A request for a newer key may
      // still be in flight (typed and then undone); abort it so it cannot
      // overwrite the results. Only a genuine key change makes a stale search
      // error irrelevant, so an install error on an unchanged query survives.
      requestRef.current?.abort();
      requestRef.current = null;
      setIsSearching(false);
      if (keyChanged) setError(null);
      return;
    }
    void runSearch(debouncedQuery);
    // `installingId` and `sortBy` are deliberately not dependencies: the
    // guards above read the current values from the fresh render closure. An
    // install finishing reruns the search only when the query or sort changed
    // while it was in flight (checked via lastSearchKeyRef, recorded only
    // once a search succeeds), so the install error the user needs to see is
    // preserved across that rerun.
  }, [open, query, debouncedQuery, installingId, runSearch]);

  const handleSortChange = useCallback((value: OpenVsxThemeSort | null) => {
    const nextSort = SORT_OPTIONS.find((option) => option.value === value)?.value;
    if (!nextSort) return;
    setSortBy(nextSort);
  }, []);

  const handleInstall = useCallback(
    async (extension: OpenVsxThemeExtension, allowUpdate: boolean) => {
      setError(null);
      let installedCollection: ReadonlyArray<ThemeDefinition>;
      try {
        installedCollection = getStoredCustomThemeCollection(extension.collectionId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Installed themes could not be read.");
        return;
      }
      const updated = installedCollection.length > 0;
      if (updated && !allowUpdate) {
        setPendingUpdate(extension);
        return;
      }

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setIsSearching(false);
      setInstallingId(extension.id);
      try {
        const themes = await importOpenVsxThemeExtension(extension, controller.signal);
        if (!controller.signal.aborted) {
          const imported = replaceCustomThemeCollection(extension.collectionId, themes, {
            expectedCollection: installedCollection,
          });
          onInstalled(imported, { updated });
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : translate("settings.theme.import.invalid"),
          );
        }
      }
      if (requestRef.current === controller) {
        requestRef.current = null;
        setInstallingId(null);
      }
    },
    [onInstalled, translate],
  );

  return (
    <section className="space-y-3" aria-labelledby="theme-search-heading">
      <div>
        <h3 className="text-sm font-medium" id="theme-search-heading">
          {translate("settings.theme.search.title")}
        </h3>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {translate("settings.theme.search.description")}
        </p>
      </div>
      <InputGroup>
        <InputGroupAddon>
          {isSearching ? <Spinner aria-hidden /> : <SearchIcon aria-hidden />}
        </InputGroupAddon>
        <InputGroupInput
          aria-label={translate("settings.theme.search.aria")}
          autoFocus
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !isSearching && installingId === null)
              void runSearch(query.trim());
          }}
          placeholder={translate("settings.theme.search.placeholder")}
          size="lg"
          type="search"
          value={query}
        />
      </InputGroup>

      {!isSearching || results !== null ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <p className="text-muted-foreground text-xs">
              {translate("settings.theme.search.popular")}
            </p>
            {SUGGESTED_SEARCHES.map((suggestion) => (
              <Button
                key={suggestion}
                disabled={installingId !== null}
                size="xs"
                variant="ghost"
                onClick={() => {
                  if (query.trim() === suggestion) {
                    void runSearch(suggestion);
                  } else {
                    setQuery(suggestion);
                  }
                }}
              >
                {suggestion}
              </Button>
            ))}
          </div>
          {results && results.length > 0 ? (
            <div className="flex shrink-0 items-center justify-end gap-2">
              <p className="text-muted-foreground text-xs">
                {translate("settings.theme.search.sort")}
              </p>
              <Select
                disabled={installingId !== null}
                value={sortBy}
                onValueChange={handleSortChange}
              >
                <SelectTrigger
                  size="sm"
                  className="w-40"
                  aria-label={translate("settings.theme.search.sortAria")}
                >
                  <SelectValue>
                    {translate(
                      SORT_OPTIONS.find((option) => option.value === sortBy)?.messageId ??
                        "settings.theme.search.sort.downloads",
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} hideIndicator value={option.value}>
                      {translate(option.messageId)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="sr-only" role="status">
        {isSearching
          ? translate("settings.theme.search.searching")
          : results
            ? translate("settings.theme.search.resultCount", { count: results.length })
            : ""}
      </div>

      {error ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm"
        >
          {error}
        </div>
      ) : null}

      {isSearching && results === null ? (
        <div className="flex min-h-20 items-center justify-center gap-2 text-muted-foreground text-sm">
          <Spinner /> {translate("settings.theme.search.searching")}
        </div>
      ) : null}

      {results ? (
        results.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
            <p className="text-sm font-medium">{translate("settings.theme.search.empty")}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {translate("settings.theme.search.tryBroader")}
            </p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {results.map((extension) => {
              const isInstalling = installingId === extension.id;
              const isInstalled = getCustomThemes().some(
                (theme) => theme.collection?.id === extension.collectionId,
              );
              const action = translate(
                isInstalled ? "settings.theme.search.update" : "settings.theme.search.install",
              );
              const progressAction = translate(
                isInstalled ? "settings.theme.search.updating" : "settings.theme.search.installing",
              );
              return (
                <article
                  className="group flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-3 transition-colors hover:bg-accent/20"
                  key={extension.id}
                >
                  <div className="flex min-w-0 gap-3">
                    <ThemeExtensionIcon key={extension.iconUrl} extension={extension} />
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-medium">{extension.name}</h4>
                      <p className="truncate text-muted-foreground text-xs">
                        {extension.publisher} ·{" "}
                        {translator.number(extension.downloadCount, {
                          notation: "compact",
                          maximumFractionDigits: 1,
                        })}{" "}
                        {translate("settings.theme.search.downloads")}
                      </p>
                    </div>
                  </div>
                  <p className="line-clamp-2 min-h-8 text-muted-foreground text-xs leading-4">
                    {extension.description ||
                      translate("settings.theme.search.fallbackDescription")}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {extension.sourceUrl ? (
                        <Button
                          aria-label={translate("settings.theme.search.viewSource", {
                            theme: extension.name,
                          })}
                          render={<a href={extension.sourceUrl} rel="noreferrer" target="_blank" />}
                          size="icon-micro"
                          variant="ghost-muted"
                        >
                          <SourceLinkIcon url={extension.sourceUrl} />
                        </Button>
                      ) : null}
                    </div>
                    <Button
                      aria-label={translate("settings.theme.search.actionAria", {
                        action: isInstalling ? progressAction : action,
                        theme: extension.name,
                      })}
                      disabled={installingId !== null}
                      size="xs"
                      variant="outline"
                      onClick={() => void handleInstall(extension, false)}
                    >
                      {isInstalling ? (
                        <Spinner />
                      ) : isInstalled ? (
                        <RefreshCwIcon />
                      ) : (
                        <PackagePlusIcon />
                      )}
                      {isInstalling ? progressAction : action}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : null}

      <AlertDialog
        open={pendingUpdate !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingUpdate(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {translate("settings.theme.search.updateTitle", {
                theme: pendingUpdate?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {translate("settings.theme.search.updateDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {translate("settings.common.cancel")}
            </AlertDialogClose>
            <Button
              onClick={() => {
                const extension = pendingUpdate;
                setPendingUpdate(null);
                if (extension) void handleInstall(extension, true);
              }}
            >
              {translate("settings.theme.search.updateTheme")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}
