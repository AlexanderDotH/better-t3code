import type {
  EnvironmentId,
  HarnessChatSessionId,
  HarnessChatSummary,
  HarnessChatSyncRunResult,
  HarnessChatSyncSource,
  HarnessChatSyncStatus,
  ProjectId,
  ProviderInstanceId,
  ServerConfig,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  CloudDownloadIcon,
  LinkIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useDeferredValue, useMemo, useState } from "react";

import { ensureEnvironmentApi } from "../../environmentApi";
import { cn } from "../../lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { useProjects, useServerConfigs } from "../../state/entities";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  clearHarnessChatSelection,
  createDefaultHarnessChatSelection,
  getHarnessChatSelectionState,
  getSelectedUnresolvedHarnessChats,
  type HarnessChatSelectionState,
  isHarnessChatSelected,
  selectAllHarnessChats,
  setHarnessChatSelected,
  toHarnessChatSelection,
} from "./HarnessChatSyncSettings.logic";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export const HARNESS_CHAT_PAGE_SIZE = 10;

interface ProjectOption {
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}

function formatChatDate(value: string | null, translator: InterfaceTranslator): string {
  if (value === null) return translator.message("settings.harness.noDatedChats");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : translator.date(date);
}

function sourceCountLabel(input: {
  readonly visibleCount: number;
  readonly totalMatching: number;
  readonly changedMatching: number;
  readonly countsAreComplete: boolean;
  readonly translator: InterfaceTranslator;
}): string {
  const formattedVisible = input.translator.number(input.visibleCount);
  const formattedChanged = input.translator.number(input.changedMatching);
  if (!input.countsAreComplete) {
    return input.changedMatching > 0
      ? input.translator.message("settings.harness.shownMoreUpdates", {
          visible: formattedVisible,
          changed: formattedChanged,
        })
      : input.translator.message("settings.harness.shownMore", { visible: formattedVisible });
  }
  return input.translator.message("settings.harness.sourceCounts", {
    chats: input.translator.message("settings.harness.chatCount", {
      count: input.totalMatching,
      formattedCount: input.translator.number(input.totalMatching),
    }),
    updates: input.translator.message("settings.harness.updateCount", {
      count: input.changedMatching,
      formattedCount: formattedChanged,
    }),
  });
}

function selectionSummaryLabel(input: {
  readonly selection: HarnessChatSelectionState;
  readonly visibleCount: number;
  readonly totalMatching: number;
  readonly changedMatching: number;
  readonly countsAreComplete: boolean;
  readonly translator: InterfaceTranslator;
}): string {
  const values = {
    selected: input.translator.number(
      input.selection.mode === "only" ? input.selection.sessionIds.length : 0,
    ),
    excluded: input.translator.number(
      input.selection.mode === "allMatching" ? input.selection.excludedSessionIds.length : 0,
    ),
    visible: input.translator.number(input.visibleCount),
    total: input.translator.number(input.totalMatching),
    changed: input.translator.number(input.changedMatching),
  };
  if (input.selection.mode === "allMatching") {
    if (input.selection.excludedSessionIds.length > 0) {
      return input.countsAreComplete
        ? input.translator.message("settings.harness.allExceptComplete", values)
        : input.translator.message("settings.harness.allExceptIncomplete", values);
    }
    return input.countsAreComplete
      ? input.translator.message("settings.harness.allSelectedComplete", values)
      : input.translator.message("settings.harness.allSelectedIncomplete", values);
  }
  return input.countsAreComplete
    ? input.translator.message("settings.harness.someSelectedComplete", values)
    : input.translator.message("settings.harness.someSelectedIncomplete", values);
}

function syncResultSummary(
  result: HarnessChatSyncRunResult,
  translator: InterfaceTranslator,
): string {
  return translator.message("settings.harness.syncSummary", {
    synced: translator.number(result.syncedCount),
    selected: translator.number(result.selectedCount),
    chatNoun: translator.message(
      result.selectedCount === 1
        ? "settings.harness.chatNounOne"
        : "settings.harness.chatNounOther",
    ),
    messages: translator.number(result.messagesImported),
  });
}

function sourceStatusBadge(
  source: HarnessChatSyncSource,
  changedMatching: number,
  isLoading: boolean,
  countsAreComplete: boolean,
  translator: InterfaceTranslator,
): ReactNode {
  if (source.status.kind === "unsupported") {
    return <Badge variant="warning">{translator.message("settings.harness.unavailable")}</Badge>;
  }
  if (source.status.kind === "already-local") {
    return <Badge variant="success">{translator.message("settings.harness.alreadyLocal")}</Badge>;
  }
  if (isLoading) {
    return <Badge variant="outline">{translator.message("settings.harness.checking")}</Badge>;
  }
  if (changedMatching > 0) {
    return (
      <Badge variant="info">
        {translator.message("settings.harness.changedCount", {
          count: changedMatching,
          formattedCount: `${translator.number(changedMatching)}${countsAreComplete ? "" : "+"}`,
        })}
      </Badge>
    );
  }
  if (!countsAreComplete) {
    return <Badge variant="outline">{translator.message("settings.harness.moreAvailable")}</Badge>;
  }
  return <Badge variant="outline">{translator.message("settings.harness.upToDate")}</Badge>;
}

function chatStatusBadges(chat: HarnessChatSummary, translator: InterfaceTranslator) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {chat.activity === "active" ? (
        <Badge variant="warning">{translator.message("settings.harness.activeElsewhere")}</Badge>
      ) : null}
      {chat.link ? (
        <Badge
          variant="outline"
          title={translator.message("settings.harness.threadTitle", {
            thread: chat.link.threadId,
          })}
        >
          <LinkIcon />
          {translator.message("settings.harness.linked")}
        </Badge>
      ) : null}
      {chat.hasChanges ? (
        <Badge variant="info">{translator.message("settings.harness.updatesAvailable")}</Badge>
      ) : null}
      {chat.archived ? (
        <Badge variant="secondary">{translator.message("settings.harness.archived")}</Badge>
      ) : null}
    </span>
  );
}

function SourceUnavailable({ source }: { readonly source: HarnessChatSyncSource }) {
  const translator = useInterfaceTranslator();
  const title = translator.message(
    source.status.kind === "already-local"
      ? "settings.harness.alreadyLocal"
      : "settings.harness.unavailable",
  );
  const reason = source.status.kind === "supported" ? "" : source.status.reason;
  return (
    <div className="px-4 pb-4">
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{reason}</p>
      </div>
    </div>
  );
}

export interface HarnessChatSyncSourceViewProps {
  readonly source: HarnessChatSyncSource;
  readonly chats: ReadonlyArray<HarnessChatSummary>;
  readonly selection: HarnessChatSelectionState;
  readonly searchQuery: string;
  readonly includeArchived: boolean;
  readonly totalMatching: number;
  readonly changedMatching: number;
  readonly countsAreComplete?: boolean;
  readonly hasNextPage: boolean;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isSyncing: boolean;
  readonly result: HarnessChatSyncRunResult | null;
  readonly errorMessage: string | null;
  readonly selectedProviderInstanceId?: ProviderInstanceId | null;
  readonly onProviderInstanceChange?: (instanceId: ProviderInstanceId) => void;
  readonly onSearchChange: (value: string) => void;
  readonly onArchiveChange: (value: boolean) => void;
  readonly onSelectionChange: (sessionId: HarnessChatSessionId, selected: boolean) => void;
  readonly onSelectAll: () => void;
  readonly onClearAll: () => void;
  readonly onLoadMore: () => void;
  readonly onRefresh: () => void;
  readonly onSync: () => void;
}

function ProviderInstancePicker({
  source,
  value,
  onChange,
}: {
  readonly source: HarnessChatSyncSource;
  readonly value: ProviderInstanceId | null;
  readonly onChange?: (instanceId: ProviderInstanceId) => void;
}) {
  const translator = useInterfaceTranslator();
  if (source.instanceIds.length < 2 || !onChange) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {translator.message("settings.harness.account")}
      <select
        aria-label={translator.message("settings.harness.providerAccount", {
          provider: source.label,
        })}
        className="h-7 max-w-48 rounded-md border border-input bg-background px-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value ?? ""}
        onChange={(event) => {
          const instanceId = source.instanceIds.find(
            (candidate) => candidate === event.currentTarget.value,
          );
          if (instanceId) onChange(instanceId);
        }}
      >
        {source.instanceIds.map((instanceId) => (
          <option key={instanceId} value={instanceId}>
            {instanceId}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChatRow({
  chat,
  selected,
  onSelectedChange,
}: {
  readonly chat: HarnessChatSummary;
  readonly selected: boolean;
  readonly onSelectedChange: (selected: boolean) => void;
}) {
  const translator = useInterfaceTranslator();
  const targetDescription =
    chat.targetProject.kind === "unresolved"
      ? translator.message("settings.harness.projectRequired")
      : chat.targetProject.kind === "create"
        ? translator.message("settings.harness.willCreate", {
            project: chat.targetProject.suggestedName,
          })
        : translator.message("settings.harness.projectMatched");
  return (
    <label className="flex cursor-pointer gap-3 border-t border-border/50 px-4 py-3 first:border-t-0">
      <Checkbox
        aria-label={translator.message("settings.harness.selectChat", { chat: chat.title })}
        checked={selected}
        onCheckedChange={(checked) => onSelectedChange(Boolean(checked))}
      />
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat.title}</span>
          {chatStatusBadges(chat, translator)}
        </span>
        {chat.preview ? (
          <span className="block truncate text-xs text-muted-foreground">{chat.preview}</span>
        ) : null}
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground/75">
          <span className="max-w-full truncate font-mono">
            {chat.cwd ?? translator.message("settings.harness.noWorkingDirectory")}
          </span>
          <span>
            {translator.message("settings.harness.messageCount", {
              count: chat.messageCount,
              formattedCount: translator.number(chat.messageCount),
            })}
          </span>
          {chat.link ? (
            <span className="font-mono">
              {translator.message("settings.harness.threadTitle", {
                thread: chat.link.threadId,
              })}
            </span>
          ) : null}
          <span>{formatChatDate(chat.updatedAt, translator)}</span>
          <span
            className={cn(chat.targetProject.kind === "unresolved" && "text-warning-foreground")}
          >
            {targetDescription}
          </span>
        </span>
      </span>
    </label>
  );
}

export function HarnessChatSyncSourceView({
  source,
  chats,
  selection,
  searchQuery,
  includeArchived,
  totalMatching,
  changedMatching,
  countsAreComplete = true,
  hasNextPage,
  isLoading,
  isFetching,
  isSyncing,
  result,
  errorMessage,
  selectedProviderInstanceId = source.preferredInstanceId,
  onProviderInstanceChange,
  onSearchChange,
  onArchiveChange,
  onSelectionChange,
  onSelectAll,
  onClearAll,
  onLoadMore,
  onRefresh,
  onSync,
}: HarnessChatSyncSourceViewProps) {
  const translator = useInterfaceTranslator();
  const visibleSessionIds = chats.map((chat) => chat.sessionId);
  const selectionState = getHarnessChatSelectionState(selection, visibleSessionIds);
  const selectionEmpty = selection.mode === "only" && selection.sessionIds.length === 0;
  const latestUpdatedAt = chats.reduce<string | null>(
    (latest, chat) => (latest === null || chat.updatedAt > latest ? chat.updatedAt : latest),
    source.latestUpdatedAt,
  );
  const matchingLabel = selectionSummaryLabel({
    selection,
    visibleCount: chats.length,
    totalMatching,
    changedMatching,
    countsAreComplete,
    translator,
  });

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-background/40">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold">{source.label}</h4>
            <Badge variant="secondary">{source.driver}</Badge>
            {sourceStatusBadge(source, changedMatching, isLoading, countsAreComplete, translator)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {sourceCountLabel({
              visibleCount: chats.length,
              totalMatching,
              changedMatching,
              countsAreComplete,
              translator,
            })}{" "}
            ·{" "}
            {translator.message("settings.harness.lastActivity", {
              date: formatChatDate(latestUpdatedAt, translator),
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProviderInstancePicker
            source={source}
            value={selectedProviderInstanceId}
            {...(onProviderInstanceChange ? { onChange: onProviderInstanceChange } : {})}
          />
          {source.status.kind === "supported" ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={translator.message("settings.harness.refreshChats", {
                provider: source.label,
              })}
              disabled={isFetching || isSyncing}
              onClick={onRefresh}
            >
              <RefreshCwIcon className={cn("size-3.5", isFetching && "animate-spin")} />
            </Button>
          ) : null}
        </div>
      </div>

      {source.status.kind !== "supported" ? (
        <SourceUnavailable source={source} />
      ) : (
        <>
          <div className="grid gap-2 border-t border-border/50 bg-muted/15 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <label className="relative min-w-0">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                size="compact"
                className="w-full [&_input]:pl-8"
                inputMode="search"
                placeholder={translator.message("settings.harness.searchPlaceholder")}
                value={searchQuery}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  onSearchChange(event.currentTarget.value)
                }
              />
            </label>
            <label className="flex min-h-7 items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={includeArchived}
                onCheckedChange={(checked) => onArchiveChange(Boolean(checked))}
              />
              <ArchiveIcon className="size-3.5" />
              {translator.message("settings.harness.includeArchived")}
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-2.5">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={selectionState === true}
                indeterminate={selectionState === "indeterminate"}
                onCheckedChange={(checked) => (checked ? onSelectAll() : onClearAll())}
              />
              {matchingLabel}
            </label>
            <div className="flex items-center gap-1">
              <Button size="xs" variant="ghost-muted" onClick={onSelectAll}>
                {translator.message("settings.harness.selectAll")}
              </Button>
              <Button size="xs" variant="ghost-muted" onClick={onClearAll}>
                {translator.message("settings.harness.clearAll")}
              </Button>
            </div>
          </div>

          <div className="border-t border-border/50">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                {translator.message("settings.harness.reading")}
              </div>
            ) : chats.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                {translator.message("settings.harness.noMatches")}
              </div>
            ) : (
              chats.map((chat) => (
                <ChatRow
                  key={chat.sessionId}
                  chat={chat}
                  selected={isHarnessChatSelected(selection, chat.sessionId)}
                  onSelectedChange={(selected) => onSelectionChange(chat.sessionId, selected)}
                />
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-muted/10 px-4 py-3">
            <div>
              {hasNextPage ? (
                <Button size="sm" variant="outline" disabled={isFetching} onClick={onLoadMore}>
                  {isFetching ? <LoaderCircleIcon className="animate-spin" /> : null}
                  {translator.message("settings.harness.viewMore")}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {translator.message("settings.harness.allShown")}
                </span>
              )}
            </div>
            <Button
              size="sm"
              disabled={selectionEmpty || (countsAreComplete && totalMatching === 0) || isSyncing}
              onClick={onSync}
            >
              {isSyncing ? <LoaderCircleIcon className="animate-spin" /> : <CloudDownloadIcon />}
              {translator.message(
                isSyncing ? "settings.harness.syncing" : "settings.harness.syncSelected",
              )}
            </Button>
          </div>

          {result ? (
            <div
              className={cn(
                "border-t px-4 py-3 text-xs",
                result.failedCount > 0
                  ? "border-warning/25 bg-warning/8 text-warning-foreground"
                  : "border-success/25 bg-success/8 text-success-foreground",
              )}
            >
              <p className="font-medium">{syncResultSummary(result, translator)}</p>
              {result.failures.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {result.failures.map((failure) => (
                    <li key={`${failure.sessionId}:${failure.code}`} className="flex gap-1.5">
                      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                      <span>{failure.message}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {errorMessage ? (
            <div className="border-t border-destructive/25 bg-destructive/8 px-4 py-3 text-xs text-destructive">
              {errorMessage}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function MissingProjectResolver({
  open,
  unresolvedCount,
  projects,
  selectedProjectId,
  isSyncing,
  onOpenChange,
  onProjectChange,
  onConfirm,
}: {
  readonly open: boolean;
  readonly unresolvedCount: number;
  readonly projects: ReadonlyArray<ProjectOption>;
  readonly selectedProjectId: ProjectId | null;
  readonly isSyncing: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onProjectChange: (projectId: ProjectId) => void;
  readonly onConfirm: () => void;
}) {
  const translator = useInterfaceTranslator();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup aria-describedby="missing-project-resolver-description">
        <DialogHeader>
          <DialogTitle>{translator.message("settings.harness.chooseProject")}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <MissingProjectResolverContent
            unresolvedCount={unresolvedCount}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onProjectChange={onProjectChange}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={isSyncing} onClick={() => onOpenChange(false)}>
            {translator.message("common.cancel")}
          </Button>
          <Button disabled={selectedProjectId === null || isSyncing} onClick={onConfirm}>
            {isSyncing ? <LoaderCircleIcon className="animate-spin" /> : null}
            {translator.message("settings.harness.syncToProject")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function MissingProjectResolverContent({
  unresolvedCount,
  projects,
  selectedProjectId,
  onProjectChange,
}: {
  readonly unresolvedCount: number;
  readonly projects: ReadonlyArray<ProjectOption>;
  readonly selectedProjectId: ProjectId | null;
  readonly onProjectChange: (projectId: ProjectId) => void;
}) {
  const translator = useInterfaceTranslator();
  return (
    <div className="space-y-4">
      <p
        id="missing-project-resolver-description"
        className="text-sm leading-relaxed text-muted-foreground"
      >
        {translator.message("settings.harness.resolverDescription", {
          count: translator.number(unresolvedCount),
          chatNoun: translator.message(
            unresolvedCount === 1 ? "settings.harness.chatHas" : "settings.harness.chatsHave",
          ),
        })}
      </p>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translator.message("settings.harness.addProjectFirst")}
        </p>
      ) : (
        <label className="grid gap-2 text-sm font-medium">
          {translator.message("settings.harness.targetProject")}
          <select
            aria-label={translator.message("settings.harness.targetProjectAria")}
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={selectedProjectId ?? ""}
            onChange={(event) => {
              const projectId = projects.find(
                (project) => project.id === event.currentTarget.value,
              )?.id;
              if (projectId) onProjectChange(projectId);
            }}
          >
            <option value="" disabled>
              {translator.message("settings.harness.selectProject")}
            </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title} — {project.workspaceRoot}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function uniqueChats(pages: ReadonlyArray<{ readonly chats: ReadonlyArray<HarnessChatSummary> }>) {
  const chats = new Map<HarnessChatSessionId, HarnessChatSummary>();
  for (const page of pages) {
    for (const chat of page.chats) chats.set(chat.sessionId, chat);
  }
  return [...chats.values()];
}

function applyStatusOverrides(
  chats: ReadonlyArray<HarnessChatSummary>,
  statusBySessionId: ReadonlyMap<HarnessChatSessionId, HarnessChatSyncStatus>,
) {
  return chats.map((chat) => {
    const status = statusBySessionId.get(chat.sessionId);
    if (!status) return chat;
    return {
      ...chat,
      activity: status.activity,
      hasChanges: status.hasChanges,
      link: status.link,
    };
  });
}

export function HarnessChatSyncSourceTabs({
  sources,
  activeSourceId,
  onSourceChange,
}: {
  readonly sources: ReadonlyArray<HarnessChatSyncSource>;
  readonly activeSourceId: HarnessChatSyncSource["id"];
  readonly onSourceChange: (sourceId: HarnessChatSyncSource["id"]) => void;
}) {
  const translator = useInterfaceTranslator();
  return (
    <div
      role="tablist"
      aria-label={translator.message("settings.harness.providersAria")}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-1 rounded-xl border border-border/60 bg-background/30 p-1"
    >
      {sources.map((source) => {
        const active = source.id === activeSourceId;
        return (
          <Button
            key={source.id}
            role="tab"
            aria-selected={active}
            size="sm"
            variant={active ? "secondary" : "ghost"}
            className="w-full min-w-0 justify-start overflow-hidden"
            onClick={() => onSourceChange(source.id)}
          >
            <span className="min-w-0 truncate">{source.label}</span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
              {source.driver}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function HarnessChatSyncSourceController({
  environmentId,
  source,
  projects,
  active,
}: {
  readonly environmentId: EnvironmentId;
  readonly source: HarnessChatSyncSource;
  readonly projects: ReadonlyArray<ProjectOption>;
  readonly active: boolean;
}) {
  const translator = useInterfaceTranslator();
  const api = useMemo(() => ensureEnvironmentApi(environmentId), [environmentId]);
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selection, setSelection] = useState(createDefaultHarnessChatSelection);
  const [selectedProviderInstanceId, setSelectedProviderInstanceId] =
    useState<ProviderInstanceId | null>(
      source.preferredInstanceId ?? source.instanceIds[0] ?? null,
    );
  const effectiveProviderInstanceId =
    selectedProviderInstanceId !== null && source.instanceIds.includes(selectedProviderInstanceId)
      ? selectedProviderInstanceId
      : (source.preferredInstanceId ?? source.instanceIds[0] ?? null);
  const [lastResult, setLastResult] = useState<HarnessChatSyncRunResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusBySessionId, setStatusBySessionId] = useState<
    ReadonlyMap<HarnessChatSessionId, HarnessChatSyncStatus>
  >(() => new Map());
  const [resolverOpen, setResolverOpen] = useState(false);
  const [resolverTargetProjectId, setResolverTargetProjectId] = useState<ProjectId | null>(null);

  const listQuery = useInfiniteQuery({
    queryKey: [
      "harnessChatSync",
      environmentId,
      source.id,
      "list",
      deferredSearchQuery,
      includeArchived,
    ],
    queryFn: ({ pageParam }) =>
      api.harnessChatSync.list({
        sourceId: source.id,
        query: deferredSearchQuery,
        includeArchived,
        ...(pageParam ? { cursor: pageParam } : {}),
        limit: HARNESS_CHAT_PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: active && source.status.kind === "supported",
  });
  const chats = useMemo(() => uniqueChats(listQuery.data?.pages ?? []), [listQuery.data?.pages]);
  const displayedChats = useMemo(
    () => applyStatusOverrides(chats, statusBySessionId),
    [chats, statusBySessionId],
  );
  const pages = listQuery.data?.pages ?? [];
  const lastPage = pages[pages.length - 1];
  const unresolvedSelectedChats = getSelectedUnresolvedHarnessChats(displayedChats, selection);
  const unresolvedFailureCount =
    lastResult?.failures.filter((failure) => failure.code === "target-unresolved").length ?? 0;

  const runMutation = useMutation({
    mutationFn: (unresolvedTargetProjectId?: ProjectId) =>
      api.harnessChatSync.run({
        sourceId: source.id,
        selection: toHarnessChatSelection(selection, { includeArchived }),
        ...(effectiveProviderInstanceId ? { providerInstanceId: effectiveProviderInstanceId } : {}),
        targetResolutions: [],
        ...(unresolvedTargetProjectId ? { unresolvedTargetProjectId } : {}),
      }),
    onMutate: () => {
      setErrorMessage(null);
      setLastResult(null);
    },
    onSuccess: (result) => {
      setLastResult(result);
      if (result.failures.some((failure) => failure.code === "target-unresolved")) {
        setResolverOpen(true);
      } else {
        setResolverOpen(false);
      }
      void queryClient.invalidateQueries({ queryKey: ["harnessChatSync", environmentId] });
    },
    onError: (error) => {
      setErrorMessage(
        error instanceof Error ? error.message : translator.message("settings.harness.syncFailed"),
      );
    },
  });
  const statusMutation = useMutation({
    mutationFn: () =>
      api.harnessChatSync.status({
        sourceId: source.id,
        sessionIds: displayedChats.map((chat) => chat.sessionId),
      }),
    onMutate: () => setErrorMessage(null),
    onSuccess: (result) =>
      setStatusBySessionId(
        new Map(result.statuses.map((status) => [status.sessionId, status] as const)),
      ),
    onError: (error) =>
      setErrorMessage(
        error instanceof Error
          ? error.message
          : translator.message("settings.harness.refreshFailed"),
      ),
    onSettled: () => void listQuery.refetch(),
  });

  const beginSync = () => {
    if (unresolvedSelectedChats.length > 0) {
      setResolverOpen(true);
      return;
    }
    runMutation.mutate(undefined);
  };
  const confirmResolvedSync = () => {
    if (!resolverTargetProjectId) return;
    runMutation.mutate(resolverTargetProjectId);
  };

  return (
    <>
      <HarnessChatSyncSourceView
        source={source}
        chats={displayedChats}
        selection={selection}
        searchQuery={searchQuery}
        includeArchived={includeArchived}
        totalMatching={lastPage?.totalMatching ?? source.chatCount}
        changedMatching={lastPage?.changedMatching ?? source.changedCount}
        countsAreComplete={lastPage?.countsAreComplete ?? true}
        hasNextPage={listQuery.hasNextPage}
        isLoading={listQuery.isLoading}
        isFetching={
          listQuery.isFetching || listQuery.isFetchingNextPage || statusMutation.isPending
        }
        isSyncing={runMutation.isPending}
        result={lastResult}
        errorMessage={
          errorMessage ??
          (listQuery.isError
            ? listQuery.error instanceof Error
              ? listQuery.error.message
              : translator.message("settings.harness.readFailed")
            : null)
        }
        selectedProviderInstanceId={effectiveProviderInstanceId}
        onProviderInstanceChange={setSelectedProviderInstanceId}
        onSearchChange={setSearchQuery}
        onArchiveChange={setIncludeArchived}
        onSelectionChange={(sessionId, selected) =>
          setSelection((current) => setHarnessChatSelected(current, sessionId, selected))
        }
        onSelectAll={() => setSelection(selectAllHarnessChats())}
        onClearAll={() => setSelection(clearHarnessChatSelection())}
        onLoadMore={() => void listQuery.fetchNextPage()}
        onRefresh={() => {
          if (displayedChats.length === 0) {
            void listQuery.refetch();
            return;
          }
          statusMutation.mutate();
        }}
        onSync={beginSync}
      />
      <MissingProjectResolver
        open={resolverOpen}
        unresolvedCount={Math.max(unresolvedSelectedChats.length, unresolvedFailureCount, 1)}
        projects={projects}
        selectedProjectId={resolverTargetProjectId}
        isSyncing={runMutation.isPending}
        onOpenChange={setResolverOpen}
        onProjectChange={setResolverTargetProjectId}
        onConfirm={confirmResolvedSync}
      />
    </>
  );
}

function HarnessChatSyncEnvironment({
  environment,
  projects,
}: {
  readonly environment: EnvironmentPresentation;
  readonly projects: ReadonlyArray<ProjectOption>;
}) {
  const translator = useInterfaceTranslator();
  const api = useMemo(
    () => ensureEnvironmentApi(environment.environmentId),
    [environment.environmentId],
  );
  const sourcesQuery = useQuery({
    queryKey: ["harnessChatSync", environment.environmentId, "sources"],
    queryFn: () => api.harnessChatSync.sources({}),
  });
  const sources = sourcesQuery.data?.sources ?? [];
  const [activeSourceId, setActiveSourceId] = useState<HarnessChatSyncSource["id"] | null>(null);
  const activeSource =
    sources.find((source) => source.id === activeSourceId) ??
    sources.find((source) => source.status.kind === "supported") ??
    sources[0] ??
    null;

  return (
    <HarnessChatSyncEnvironmentView
      label={environment.label}
      detail={environment.displayUrl ?? translator.message("settings.harness.primaryEnvironment")}
      isRefreshing={sourcesQuery.isFetching}
      onRefresh={() => void sourcesQuery.refetch()}
    >
      {sourcesQuery.isLoading ? (
        <div className="rounded-xl border border-border/50 px-4 py-8 text-center text-xs text-muted-foreground">
          {translator.message("settings.harness.discovering")}
        </div>
      ) : sourcesQuery.isError ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-xs text-destructive">
          {sourcesQuery.error instanceof Error
            ? sourcesQuery.error.message
            : translator.message("settings.harness.discoverFailed")}
        </div>
      ) : sources.length === 0 ? (
        <div className="rounded-xl border border-border/50 px-4 py-8 text-center text-xs text-muted-foreground">
          {translator.message("settings.harness.noSources")}
        </div>
      ) : activeSource ? (
        <>
          <HarnessChatSyncSourceTabs
            sources={sources}
            activeSourceId={activeSource.id}
            onSourceChange={setActiveSourceId}
          />
          {sources.map((source) => {
            const active = source.id === activeSource.id;
            return (
              <div
                key={source.id}
                role="tabpanel"
                aria-label={translator.message("settings.harness.sourceChats", {
                  provider: source.label,
                })}
                hidden={!active}
              >
                <HarnessChatSyncSourceController
                  environmentId={environment.environmentId}
                  source={source}
                  projects={projects}
                  active={active}
                />
              </div>
            );
          })}
        </>
      ) : null}
    </HarnessChatSyncEnvironmentView>
  );
}

export function HarnessChatSyncEnvironmentView({
  label,
  detail,
  isRefreshing,
  onRefresh,
  children,
}: {
  readonly label: string;
  readonly detail: string;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly children: ReactNode;
}) {
  const translator = useInterfaceTranslator();
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/10 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{label}</h3>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={translator.message("settings.harness.refreshSources", {
            environment: label,
          })}
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
        </Button>
      </div>
      {children}
    </div>
  );
}

export function supportsHarnessChatSync(config: ServerConfig | undefined): boolean {
  return (config?.environment.capabilities.harnessChatSyncVersion ?? 0) >= 1;
}

export function HarnessChatSyncSettings() {
  const translator = useInterfaceTranslator();
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const projects = useProjects();
  const capableEnvironments = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" &&
      supportsHarnessChatSync(serverConfigs.get(environment.environmentId)),
  );
  if (capableEnvironments.length === 0) return null;

  return (
    <SettingsSection
      {...searchableSetting("harness-chat-sync")}
      icon={<CloudDownloadIcon className="size-4" />}
    >
      <SettingsRow
        title={translator.message("settings.harness.title")}
        description={translator.message("settings.harness.description")}
      />
      <div className="space-y-4">
        {capableEnvironments.map((environment) => (
          <HarnessChatSyncEnvironment
            key={environment.environmentId}
            environment={environment}
            projects={projects
              .filter((project) => project.environmentId === environment.environmentId)
              .map(({ id, title, workspaceRoot }) => ({ id, title, workspaceRoot }))}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
