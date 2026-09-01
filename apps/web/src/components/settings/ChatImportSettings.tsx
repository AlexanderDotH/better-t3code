import type { T3ChatImportRunResult, T3ChatImportSource } from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DatabaseIcon, DownloadIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useActiveEnvironmentId } from "../../state/entities";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { requireSettingsEnvironment, resolveSettingsEnvironmentId } from "./settingsEnvironment";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function formatLatestChat(value: string | null, translator: InterfaceTranslator): string {
  if (value === null) return translator.message("settings.chatImport.noDatedChats");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : translator.message("settings.chatImport.latestChat", { date: translator.date(date) });
}

function importSummary(result: T3ChatImportRunResult, translator: InterfaceTranslator): string {
  const attachmentSummary =
    result.attachmentsCopied > 0 || result.attachmentsSkipped > 0
      ? ` ${translator.message(
          result.attachmentsSkipped > 0
            ? "settings.chatImport.attachments"
            : "settings.chatImport.attachmentsCopied",
          { copied: result.attachmentsCopied, skipped: result.attachmentsSkipped },
        )}`
      : "";
  return `${translator.message("settings.chatImport.summary", {
    threads: result.threadsImported,
    messages: result.messagesImported,
    projects: result.projectsImported,
  })}${attachmentSummary}`;
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
  const translator = useInterfaceTranslator();
  return (
    <SettingsRow
      title={source.label}
      description={source.databasePath}
      status={`${translator.message("settings.chatImport.chatCount", {
        count: source.threadCount,
      })} · ${formatLatestChat(source.latestUpdatedAt, translator)}`}
      control={
        <Button size="sm" disabled={isImporting} onClick={() => onImport(source)}>
          <DownloadIcon className="size-3.5" />
          {isImporting
            ? translator.message("settings.chatImport.importing")
            : translator.message("settings.chatImport.title")}
        </Button>
      }
    />
  );
}

export function ChatImportSettingsPanel() {
  const translator = useInterfaceTranslator();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const activeEnvironmentId = useActiveEnvironmentId();
  const environmentSelection = {
    primaryEnvironmentId,
    selectedEnvironmentId: activeEnvironmentId,
  };
  const environmentId = resolveSettingsEnvironmentId(environmentSelection);
  const [lastResult, setLastResult] = useState<T3ChatImportRunResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sourcesQuery = useQuery({
    queryKey: ["chatImport", environmentId, "sources"],
    queryFn: () => requireSettingsEnvironment(environmentSelection).api.chatImport.discover(),
    enabled: environmentId !== null,
  });
  const importMutation = useMutation({
    mutationFn: (source: T3ChatImportSource) =>
      requireSettingsEnvironment(environmentSelection).api.chatImport.run({
        sourceId: source.id,
      }),
    onMutate: () => {
      setLastResult(null);
      setErrorMessage(null);
    },
    onSuccess: (result) => setLastResult(result),
    onError: (error) =>
      setErrorMessage(
        error instanceof Error ? error.message : translator.message("settings.chatImport.failed"),
      ),
  });

  const sources = sourcesQuery.data?.sources ?? [];
  const activeSourceId = importMutation.variables?.id;

  return (
    <SettingsPageContainer>
      <SettingsSection
        title={translator.message("settings.chatImport.title")}
        icon={<DatabaseIcon className="size-3.5" />}
        headerAction={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={translator.message("settings.chatImport.scan")}
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
            {translator.message("settings.chatImport.scanning")}
          </div>
        ) : sourcesQuery.isError ? (
          <div className="px-5 py-10 text-center text-sm text-destructive">
            {sourcesQuery.error instanceof Error
              ? sourcesQuery.error.message
              : translator.message("settings.chatImport.scanFailed")}
          </div>
        ) : sources.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium">{translator.message("settings.chatImport.empty")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {translator.message("settings.chatImport.scanDescription")}
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
          {importSummary(lastResult, translator)}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        {translator.message("settings.chatImport.note")}
      </p>
    </SettingsPageContainer>
  );
}
