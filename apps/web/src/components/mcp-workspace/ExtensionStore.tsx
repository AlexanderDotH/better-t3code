import type { EnvironmentId, ExtensionCatalogEntry, ProviderInstanceId } from "@t3tools/contracts";
import { CheckIcon, SearchIcon, ShoppingBagIcon, SparklesIcon, UnplugIcon } from "lucide-react";
import { useState } from "react";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { agentSettingsEnvironment } from "~/state/agentSettings";
import { useServerConfigs } from "~/state/entities";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { ExtensionInstallDialog } from "./ExtensionInstallDialog";
import { ExtensionSourceDialog } from "./ExtensionSourceDialog";
import "./ExtensionStore.css";

interface ExtensionStoreProps {
  environmentId: EnvironmentId;
  projectCwd?: string | null | undefined;
  providerInstanceId?: ProviderInstanceId | null | undefined;
  initialKind?: "mcp" | "skill";
  onManageInstalled?: (kind: "mcp" | "skill") => void;
}

export function ExtensionStore(props: ExtensionStoreProps) {
  const translator = useInterfaceTranslator();
  const t = translator.message;
  const [kind, setKind] = useState<"mcp" | "skill">(props.initialKind ?? "mcp");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [selected, setSelected] = useState<ExtensionCatalogEntry | null>(null);
  const [sourceEntry, setSourceEntry] = useState<ExtensionCatalogEntry | null>(null);
  const [notice, setNotice] = useState<"mcp" | "skill" | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  const config = useServerConfigs().get(props.environmentId);
  const supported = (config?.environment.capabilities.extensionStoreVersion ?? 0) >= 1;
  const search = useEnvironmentQuery(
    supported
      ? agentSettingsEnvironment.catalogSearchQuery({
          environmentId: props.environmentId,
          input: { kind, query: debouncedQuery, ...(cursor ? { cursor } : {}) },
        })
      : null,
  );
  const skills = useEnvironmentQuery(
    supported
      ? agentSettingsEnvironment.skills.listQuery({
          environmentId: props.environmentId,
          input: props.projectCwd ? { projectCwd: props.projectCwd } : {},
        })
      : null,
  );
  const access = useEnvironmentQuery(
    agentSettingsEnvironment.mcp.sessionAccess({ environmentId: props.environmentId, input: {} }),
  );
  const readOnly = !access.data?.scopes?.includes("orchestration:operate");
  const isInstalled = (entry: ExtensionCatalogEntry) =>
    (entry.kind === "mcp"
      ? config?.settings.mcp.servers.some((server) => server.id === entry.id)
      : skills.data?.skills.some((skill) => skill.name === entry.id.split("/").at(-1))) === true;
  const updateSearch = (value: string) => {
    setQuery(value);
    setCursor(undefined);
  };
  const searching = search.isPending || query.trim() !== debouncedQuery;
  const entries = search.data?.entries ?? [];

  return (
    <div className="extension-store">
      <div className="extension-store__intro">
        <div>
          <h2>{t("settings.mcp.store.title")}</h2>
          <p>{t("settings.mcp.store.description")}</p>
        </div>
        <div
          className="extension-store__filters"
          role="group"
          aria-label={t("settings.mcp.store.kind")}
        >
          {(["mcp", "skill"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={kind === value ? "secondary" : "ghost"}
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                updateSearch("");
              }}
            >
              {value === "mcp" ? (
                <UnplugIcon className="size-3.5" />
              ) : (
                <SparklesIcon className="size-3.5" />
              )}
              {t(value === "mcp" ? "settings.mcp.store.servers" : "settings.mcp.store.skills")}
            </Button>
          ))}
        </div>
      </div>
      {!supported ? (
        <p className="extension-store__empty">{t("settings.mcp.store.upgrade")}</p>
      ) : (
        <>
          <div className="extension-store__search">
            <SearchIcon aria-hidden="true" className="size-4" />
            <Input
              type="search"
              value={query}
              maxLength={200}
              onChange={(event) => updateSearch(event.currentTarget.value)}
              placeholder={t(
                kind === "mcp" ? "settings.mcp.store.searchMcp" : "settings.mcp.store.searchSkills",
              )}
              aria-label={t("settings.mcp.store.search")}
            />
          </div>
          <div className="extension-store__topics">
            {(kind === "mcp"
              ? ["GitHub", "Playwright", "Postgres", "Context7"]
              : ["React", "Testing", "Design", "Code review"]
            ).map((topic) => (
              <Button key={topic} size="xs" variant="outline" onClick={() => updateSearch(topic)}>
                {topic}
              </Button>
            ))}
          </div>
          <p className="extension-store__description">
            {t(
              kind === "mcp"
                ? "settings.mcp.store.mcpDescription"
                : debouncedQuery.length < 2
                  ? "settings.mcp.store.suggestions"
                  : "settings.mcp.store.skillDescription",
            )}
          </p>
          {notice ? (
            <p role="status" className="extension-store__notice">
              <CheckIcon className="size-4 shrink-0" />
              {t("settings.mcp.store.success")}
              {props.onManageInstalled ? (
                <Button size="xs" variant="ghost" onClick={() => props.onManageInstalled?.(notice)}>
                  {t("settings.mcp.store.manage")}
                </Button>
              ) : null}
            </p>
          ) : null}
          {search.error ? (
            <div role="alert" className="extension-store__empty">
              <p>{search.error}</p>
              <Button variant="outline" size="sm" onClick={search.refresh}>
                {t("settings.mcp.store.retry")}
              </Button>
            </div>
          ) : searching ? (
            <p className="extension-store__empty" role="status">
              {t("settings.mcp.store.searching")}
            </p>
          ) : entries.length === 0 ? (
            <p className="extension-store__empty">{t("settings.mcp.store.noResults")}</p>
          ) : (
            <div className="extension-store__results">
              {entries.map((entry) => {
                const installed = isInstalled(entry);
                return (
                  <article key={entry.id} className="extension-store__result">
                    <div className="extension-store__result-heading">
                      <h3>
                        <button
                          type="button"
                          className="extension-store__details-trigger"
                          onClick={() => setSourceEntry(entry)}
                        >
                          {entry.name}
                        </button>
                      </h3>
                      {entry.version ? <span>{entry.version}</span> : null}
                    </div>
                    <div
                      className="extension-store__availability"
                      data-installed={installed || undefined}
                    >
                      {installed ? <CheckIcon aria-hidden="true" className="size-3" /> : null}
                      {t(
                        installed
                          ? "settings.mcp.store.installed"
                          : "settings.mcp.store.notInstalled",
                      )}
                    </div>
                    <p className="extension-store__source">{entry.source}</p>
                    {entry.description ? (
                      <p className="extension-store__summary">{entry.description}</p>
                    ) : null}
                    {entry.installs !== undefined ? (
                      <p className="extension-store__description">
                        {translator.number(entry.installs)} {t("settings.mcp.store.installs")}
                      </p>
                    ) : null}
                    <div className="extension-store__result-actions">
                      <Button size="xs" variant="ghost" onClick={() => setSourceEntry(entry)}>
                        {t("settings.mcp.store.source")}
                      </Button>
                      {installed ? (
                        props.onManageInstalled ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => props.onManageInstalled?.(entry.kind)}
                          >
                            {t("settings.mcp.store.manage")}
                          </Button>
                        ) : null
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setSelected(entry)}>
                          {t(
                            entry.kind === "skill"
                              ? "settings.mcp.store.preview"
                              : "settings.mcp.store.setup",
                          )}
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <div className="extension-store__pagination">
            {cursor ? (
              <Button size="sm" variant="ghost" onClick={() => setCursor(undefined)}>
                {t("settings.mcp.store.back")}
              </Button>
            ) : null}
            {search.data?.nextCursor ? (
              <Button
                size="sm"
                variant="outline"
                disabled={searching}
                onClick={() => setCursor(search.data?.nextCursor)}
              >
                {t("settings.mcp.store.next")}
              </Button>
            ) : null}
          </div>
        </>
      )}
      {sourceEntry ? (
        <ExtensionSourceDialog
          key={sourceEntry.id}
          entry={sourceEntry}
          environmentId={props.environmentId}
          onClose={() => setSourceEntry(null)}
          installed={isInstalled(sourceEntry)}
          {...(props.onManageInstalled
            ? { onManage: () => props.onManageInstalled?.(sourceEntry.kind) }
            : {})}
          onSetup={() => {
            setSelected(sourceEntry);
            setSourceEntry(null);
          }}
        />
      ) : null}
      {selected ? (
        <ExtensionInstallDialog
          key={selected.id}
          {...props}
          entry={selected}
          readOnly={readOnly}
          installed={isInstalled(selected)}
          onClose={() => setSelected(null)}
          onInstalled={() => {
            setNotice(selected.kind);
            setSelected(null);
            skills.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

export function ExtensionStoreButton(props: ExtensionStoreProps & { onBrowse?: () => void }) {
  const t = useInterfaceTranslator().message;
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        onClick={() => (props.onBrowse ? props.onBrowse() : setOpen(true))}
      >
        <ShoppingBagIcon className="size-3.5" />
        {t("settings.mcp.store.browse")}
      </Button>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogPopup className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{t("settings.mcp.store.browse")}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[75dvh] overflow-y-auto">
              <ExtensionStore {...props} />
            </div>
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}
