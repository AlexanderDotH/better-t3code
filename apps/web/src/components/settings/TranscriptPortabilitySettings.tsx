import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { ChatTranscriptCopyButton } from "../chat/ChatTranscriptCopyButton";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import {
  buildTranscriptPortabilityOptions,
  isTranscriptExportPending,
} from "./TranscriptPortabilitySettings.logic";

function optionKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return JSON.stringify([environmentId, threadId]);
}

export function TranscriptPortabilitySettings({
  environmentId,
}: {
  environmentId: EnvironmentId | null;
}) {
  const translate = useInterfaceTranslator().message;
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const supportedEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter(
            (environment) =>
              environment.connection.phase === "connected" &&
              (environment.serverConfig?.environment.capabilities.agentWorkflowVersion ?? 0) >= 1,
          )
          .map((environment) => environment.environmentId),
      ),
    [environments],
  );
  const options = useMemo(
    () => buildTranscriptPortabilityOptions(threads, supportedEnvironmentIds, environmentId),
    [environmentId, supportedEnvironmentIds, threads],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected =
    options.find((option) => optionKey(option.environmentId, option.id) === selectedKey) ?? null;

  return (
    <SettingsSection
      id="transcript-portability"
      title={translate("settings.betterT3.transcript.title")}
    >
      <SettingsRow
        title={translate("settings.betterT3.transcript.selectThread")}
        description={translate("settings.betterT3.transcript.description")}
        status={options.length === 0 ? translate("settings.betterT3.transcript.empty") : null}
        control={
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Select
              value={selected ? selectedKey : null}
              onValueChange={setSelectedKey}
              disabled={options.length === 0}
            >
              <SelectTrigger
                className="w-full max-w-72 sm:w-72"
                aria-label={translate("settings.betterT3.transcript.selectThread")}
              >
                <SelectValue>
                  {selected?.title ?? translate("settings.betterT3.transcript.selectThread")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end">
                {options.map((option) => (
                  <SelectItem
                    key={optionKey(option.environmentId, option.id)}
                    value={optionKey(option.environmentId, option.id)}
                  >
                    {option.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {selected ? (
              <ChatTranscriptCopyButton
                key={optionKey(selected.environmentId, selected.id)}
                activeTurnInProgress={isTranscriptExportPending(selected)}
                environmentId={selected.environmentId}
                environmentUnavailable={!supportedEnvironmentIds.has(selected.environmentId)}
                threadId={selected.id}
              />
            ) : null}
          </div>
        }
      />
    </SettingsSection>
  );
}
