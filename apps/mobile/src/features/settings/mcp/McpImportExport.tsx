import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  McpMutationResult,
  McpProviderRouting,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { uuidv4 } from "../../../lib/uuid";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { agentSettingsEnvironment } from "../../../state/agent-settings";
import { useEnvironmentQuery } from "../../../state/query";
import {
  ManagementChoices,
  ManagementError,
  ManagementField,
  ManagementImportSources,
  ManagementScopeFields,
  ManagementToggle,
  McpProviderRoutingFields,
} from "./ManagementFields";
import {
  managementScopeInput,
  validateMcpImportJson,
  validateMcpRouting,
  type ManagementScope,
} from "./mcp-form";
import { useManagementCommand, useManagementTask } from "./useManagementCommand";

export function McpImportPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly initialScope: ManagementScope;
  readonly projects: readonly EnvironmentProject[];
  readonly providers: readonly ServerProvider[];
  readonly onImported: (result: McpMutationResult) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [mode, setMode] = useState<"json" | "sources">("json");
  const [json, setJson] = useState("");
  const [scope, setScope] = useState(props.initialScope);
  const [providerRouting, setProviderRouting] = useState<McpProviderRouting>({ mode: "all" });
  const [replace, setReplace] = useState(false);
  const [deduplicate, setDeduplicate] = useState(true);
  const [selection, setSelection] = useState<readonly string[] | null>(null);
  const sources = useEnvironmentQuery(
    mode === "sources"
      ? agentSettingsEnvironment.mcp.importSourcesQuery({
          environmentId: props.environmentId,
          input: {},
        })
      : null,
  );
  const selectedIds =
    selection ??
    sources.data?.sources
      .filter((source) => source.mcpServerCount > 0)
      .map((source) => source.id) ??
    [];
  const importJson = useManagementCommand(agentSettingsEnvironment.mcp.importCursorJson);
  const importSources = useManagementCommand(agentSettingsEnvironment.mcp.importSources);
  const allowed = useAtomValue(
    (mode === "json"
      ? agentSettingsEnvironment.mcp.importCursorJson
      : agentSettingsEnvironment.mcp.importSources
    ).permissionAtom(props.environmentId),
  );
  const task = useManagementTask();
  const disabled = task.pending || !allowed;
  return (
    <View className="gap-5">
      <ManagementChoices
        label={translator.message("mobile.mcp.importFrom")}
        value={mode}
        choices={[
          { value: "json", label: translator.message("mobile.mcp.json") },
          { value: "sources", label: translator.message("mobile.mcp.hostSources") },
        ]}
        disabled={disabled}
        onChange={setMode}
      />
      {mode === "json" ? (
        <>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={translator.message("mobile.mcp.pasteJson")}
              disabled={disabled}
              onPress={() => void task.run(async () => setJson(await Clipboard.getStringAsync()))}
            />
            <Button
              label={translator.message("mobile.mcp.chooseFile")}
              disabled={disabled}
              onPress={() =>
                void task.run(async () => {
                  const result = await DocumentPicker.getDocumentAsync({
                    type: ["application/json", "text/plain", "application/octet-stream"],
                    copyToCacheDirectory: true,
                  });
                  if (!result.canceled && result.assets[0]) {
                    const file = new File(result.assets[0].uri);
                    await (async () => {
                      setJson(await file.text());
                    })().finally(() => {
                      if (file.exists) file.delete();
                    });
                  }
                })
              }
            />
          </View>
          <ManagementField
            label={translator.message("mobile.mcp.json")}
            value={json}
            onChangeText={setJson}
            multiline
            disabled={disabled}
            placeholder={'{"mcpServers": {}}'}
          />
        </>
      ) : (
        <>
          {sources.isPending ? (
            <AppText className="text-sm text-foreground-muted">
              {translator.message("settings.mcp.import.scanning")}
            </AppText>
          ) : null}
          <ManagementImportSources
            kind="mcp"
            sources={sources.data?.sources ?? []}
            selectedIds={selectedIds}
            onChange={setSelection}
            disabled={disabled}
          />
          <ManagementError message={sources.error} />
          <Button
            label={translator.message("settings.mcp.export.refresh")}
            onPress={sources.refresh}
            disabled={disabled}
          />
          <ManagementToggle
            label={translator.message("settings.mcp.import.deduplicate")}
            value={deduplicate}
            onChange={setDeduplicate}
            disabled={disabled}
          />
        </>
      )}
      <ManagementScopeFields
        value={scope}
        projects={props.projects}
        onChange={setScope}
        disabled={disabled}
      />
      <McpProviderRoutingFields
        value={providerRouting}
        providers={props.providers}
        onChange={setProviderRouting}
        disabled={disabled}
      />
      <ManagementToggle
        label={translator.message("settings.mcp.import.replace")}
        value={replace}
        onChange={setReplace}
        disabled={disabled}
      />
      <ManagementError message={task.error} />
      <Button
        label={translator.message("settings.mcp.import.action")}
        tone="primary"
        loading={task.pending}
        disabled={disabled || (mode === "json" ? !json.trim() : selectedIds.length === 0)}
        onPress={() =>
          void task.run(async () => {
            const sharedInput = {
              ...managementScopeInput(scope),
              providerRouting: validateMcpRouting(providerRouting),
              replace,
            };
            const result =
              mode === "json"
                ? await importJson({
                    environmentId: props.environmentId,
                    input: { ...sharedInput, json: validateMcpImportJson(json) },
                  })
                : await importSources({
                    environmentId: props.environmentId,
                    input: { ...sharedInput, sourceIds: selectedIds, deduplicate },
                  });
            if (result) props.onImported(result);
          })
        }
      />
    </View>
  );
}

export function McpExportPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly initialScope: ManagementScope;
  readonly projects: readonly EnvironmentProject[];
  readonly providers: readonly ServerProvider[];
}) {
  const translator = useMobileInterfaceTranslator();
  const [scope, setScope] = useState(props.initialScope);
  const [allScopes, setAllScopes] = useState(false);
  const [includeDisabled, setIncludeDisabled] = useState(false);
  const [providerInstanceId, setProviderInstanceId] = useState<ProviderInstanceId | "all">("all");
  const [exported, setExported] = useState<{
    readonly inputKey: string;
    readonly json: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const exportJson = useManagementCommand(agentSettingsEnvironment.mcp.exportCursorJson);
  const allowed = useAtomValue(
    agentSettingsEnvironment.mcp.exportCursorJson.permissionAtom(props.environmentId),
  );
  const task = useManagementTask();
  const inputKey = JSON.stringify([scope, allScopes, includeDisabled, providerInstanceId]);
  const json = exported?.inputKey === inputKey ? exported.json : "";
  const disabled = task.pending || !allowed;
  return (
    <View className="gap-5">
      <AppText className="text-sm text-foreground-muted">
        {translator.message("settings.mcp.export.assignmentWarning")}
      </AppText>
      <ManagementToggle
        label={translator.message("mobile.mcp.allScopes")}
        value={allScopes}
        onChange={setAllScopes}
        disabled={disabled}
      />
      {!allScopes ? (
        <ManagementScopeFields
          value={scope}
          projects={props.projects}
          onChange={setScope}
          disabled={disabled}
        />
      ) : null}
      <ManagementChoices
        label={translator.message("settings.mcp.editor.enableFor")}
        value={providerInstanceId}
        choices={[
          { value: "all", label: translator.message("settings.mcp.import.allAccounts") },
          ...props.providers.map((provider) => ({
            value: provider.instanceId,
            label: provider.displayName ?? provider.instanceId,
          })),
        ]}
        onChange={setProviderInstanceId}
        disabled={disabled}
      />
      <ManagementToggle
        label={translator.message("settings.mcp.export.includeDisabled")}
        value={includeDisabled}
        onChange={setIncludeDisabled}
        disabled={disabled}
      />
      <Button
        label={translator.message("mobile.mcp.generateExport")}
        disabled={disabled}
        loading={task.pending}
        onPress={() =>
          void task.run(async () => {
            const result = await exportJson({
              environmentId: props.environmentId,
              input: {
                ...(allScopes ? {} : managementScopeInput(scope)),
                ...(providerInstanceId === "all" ? {} : { providerInstanceId }),
                includeDisabled,
              },
            });
            if (result) {
              setExported({ inputKey, json: result.json });
              setCopied(false);
            }
          })
        }
      />
      {json ? (
        <>
          <AppText
            className="rounded-xl bg-subtle p-3 font-mono text-sm text-foreground"
            selectable
          >
            {json}
          </AppText>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={translator.message("settings.mcp.export.copy")}
              disabled={disabled}
              onPress={() =>
                void task.run(async () => {
                  if (!(await Clipboard.setStringAsync(json)))
                    throw new Error(translator.message("mobile.mcp.clipboardFailed"));
                  setCopied(true);
                })
              }
            />
            <Button
              label={translator.message("mobile.mcp.shareJson")}
              disabled={disabled}
              onPress={() =>
                void task.run(async () => {
                  if (!(await Sharing.isAvailableAsync())) {
                    if (!(await Clipboard.setStringAsync(json)))
                      throw new Error(translator.message("mobile.mcp.clipboardFailed"));
                    setCopied(true);
                    return;
                  }
                  const file = new File(Paths.cache, `mcp-${uuidv4()}.json`);
                  await (async () => {
                    file.create();
                    file.write(json);
                    await Sharing.shareAsync(file.uri, {
                      mimeType: "application/json",
                      UTI: "public.json",
                    });
                  })().finally(() => {
                    if (file.exists) file.delete();
                  });
                })
              }
            />
          </View>
          {copied ? (
            <AppText className="text-sm text-foreground-muted">
              {translator.message("settings.mcp.toast.copied")}
            </AppText>
          ) : null}
        </>
      ) : null}
      <ManagementError message={task.error} />
    </View>
  );
}
