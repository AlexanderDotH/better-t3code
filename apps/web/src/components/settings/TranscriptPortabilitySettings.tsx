import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useServerConfigs, useThreadShells } from "../../state/entities";
import { ChatTranscriptCopyButton } from "../chat/ChatTranscriptCopyButton";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { buildTranscriptPortabilityOptions } from "./TranscriptPortabilitySettings.logic";

function optionKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return JSON.stringify([environmentId, threadId]);
}

export function TranscriptPortabilitySettings() {
  const translate = useInterfaceTranslator().message;
  const threads = useThreadShells();
  const serverConfigs = useServerConfigs();
  const supportedEnvironmentIds = useMemo(
    () =>
      new Set(
        [...serverConfigs]
          .filter(([, config]) => (config.environment.capabilities.agentWorkflowVersion ?? 0) >= 1)
          .map(([environmentId]) => environmentId),
      ),
    [serverConfigs],
  );
  const options = useMemo(
    () => buildTranscriptPortabilityOptions(threads, supportedEnvironmentIds),
    [supportedEnvironmentIds, threads],
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
              value={selectedKey}
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
                activeTurnInProgress={
                  selected.session?.status === "starting" || selected.session?.status === "running"
                }
                environmentId={selected.environmentId}
                environmentUnavailable={!serverConfigs.has(selected.environmentId)}
                threadId={selected.id}
              />
            ) : null}
          </div>
        }
      />
    </SettingsSection>
  );
}
