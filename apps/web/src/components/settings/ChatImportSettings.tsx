import type { T3ChatImportRunResult, T3ChatImportSource } from "@t3tools/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DatabaseIcon, DownloadIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function formatLatestChat(value: string | null): string {
  if (value === null) return "No dated chats";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `Latest chat ${date.toLocaleString()}`;
}

function importSummary(result: T3ChatImportRunResult): string {
  const attachmentSummary =
    result.attachmentsCopied > 0 || result.attachmentsSkipped > 0
      ? ` ${result.attachmentsCopied} attachments copied${
          result.attachmentsSkipped > 0 ? `, ${result.attachmentsSkipped} unavailable` : ""
        }.`
      : "";
  return `Synced ${result.threadsImported} chats and ${result.messagesImported} messages from ${result.projectsImported} projects.${attachmentSummary}`;
}

function SourceRow({
  source,
  isImporting,
  onImport,
}: {
  source: T3ChatImportSource;
  isImporting: boolean;
  onImport: (source: T3ChatImportSource) => void;
}) {
  return (
    <SettingsRow
      title={source.label}
      description={source.databasePath}
      status={`${source.threadCount} ${source.threadCount === 1 ? "chat" : "chats"} · ${formatLatestChat(source.latestUpdatedAt)}`}
      control={
        <Button size="sm" disabled={isImporting} onClick={() => onImport(source)}>
          <DownloadIcon className="size-3.5" />
          {isImporting ? "Importing…" : "Import chats"}
        </Button>
      }
    />
  );
}

export function ChatImportSettingsPanel() {
  const [lastResult, setLastResult] = useState<T3ChatImportRunResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sourcesQuery = useQuery({
    queryKey: ["chatImport", "sources"],
    queryFn: () => ensureLocalApi().chatImport.discover(),
  });
  const importMutation = useMutation({
    mutationFn: (source: T3ChatImportSource) =>
      ensureLocalApi().chatImport.run({ sourceId: source.id }),
    onMutate: () => {
      setLastResult(null);
      setErrorMessage(null);
    },
    onSuccess: (result) => setLastResult(result),
    onError: (error) =>
      setErrorMessage(error instanceof Error ? error.message : "Could not import chats."),
  });

  const sources = sourcesQuery.data?.sources ?? [];
  const activeSourceId = importMutation.variables?.id;

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Import chats"
        icon={<DatabaseIcon className="size-3.5" />}
        headerAction={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Scan for T3 Code instances"
            disabled={sourcesQuery.isFetching || importMutation.isPending}
            onClick={() => void sourcesQuery.refetch()}
          >
            <RefreshCwIcon
              className={sourcesQuery.isFetching ? "size-3.5 animate-spin" : "size-3.5"}
            />
          </Button>
        }
      >
        {sourcesQuery.isLoading ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Looking for other T3 Code instances…
          </div>
        ) : sourcesQuery.isError ? (
          <div className="px-5 py-10 text-center text-sm text-destructive">
            {sourcesQuery.error instanceof Error
              ? sourcesQuery.error.message
              : "Could not scan for T3 Code instances."}
          </div>
        ) : sources.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium">No other T3 Code chats found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              T3 Code scans local .t3 and .t3-* data directories on this computer.
            </p>
          </div>
        ) : (
          sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              isImporting={importMutation.isPending && activeSourceId === source.id}
              onImport={(selected) => importMutation.mutate(selected)}
            />
          ))
        )}
      </SettingsSection>

      {lastResult ? (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {importSummary(lastResult)}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Imported chats receive new local IDs and do not resume sessions from the source instance.
        Running the import again safely syncs the same chats without creating duplicates.
      </p>
    </SettingsPageContainer>
  );
}
