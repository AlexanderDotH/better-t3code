import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  McpMutationResult,
  McpServerDefinition,
  ServerProvider,
} from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { uuidv4 } from "../../../lib/uuid";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { agentSettingsEnvironment } from "../../../state/agent-settings";
import {
  ManagementChoices,
  ManagementError,
  ManagementField,
  ManagementScopeFields,
  ManagementToggle,
  McpProviderRoutingFields,
} from "./ManagementFields";
import {
  mcpDraftFromServer,
  mcpServerFromDraft,
  type ManagementScope,
  type McpSecretDraft,
} from "./mcp-form";
import { useManagementCommand, useManagementTask } from "./useManagementCommand";

function SecretEntriesEditor(props: {
  readonly label: string;
  readonly entries: readonly McpSecretDraft[];
  readonly onChange: (entries: readonly McpSecretDraft[]) => void;
  readonly disabled: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const patchEntry = (rowId: string, patch: Partial<McpSecretDraft>) =>
    props.onChange(
      props.entries.map((entry) => (entry.rowId === rowId ? { ...entry, ...patch } : entry)),
    );
  return (
    <View className="gap-3">
      <AppText className="font-t3-medium text-foreground">{props.label}</AppText>
      {props.entries.map((entry) => (
        <View key={entry.rowId} className="gap-3 rounded-xl border border-border-subtle p-3">
          <ManagementField
            label={translator.message("settings.mcp.editor.name")}
            value={entry.name}
            disabled={props.disabled}
            onChangeText={(name) => patchEntry(entry.rowId, { name })}
          />
          <ManagementField
            label={translator.message("settings.mcp.editor.value")}
            value={entry.value}
            placeholder={
              entry.valueRedacted
                ? translator.message("settings.mcp.editor.storedSecret")
                : undefined
            }
            secureTextEntry={entry.sensitive}
            disabled={props.disabled}
            onChangeText={(value) => patchEntry(entry.rowId, { value, valueRedacted: false })}
          />
          <ManagementToggle
            label={translator.message("settings.mcp.editor.sensitive")}
            value={entry.sensitive}
            disabled={props.disabled}
            onChange={(sensitive) => patchEntry(entry.rowId, { sensitive })}
          />
          <Button
            label={translator.message("mobile.mcp.removeEntry")}
            accessibilityLabel={translator.message("settings.mcp.editor.removeValue", {
              name: entry.name || props.label,
            })}
            tone="text"
            disabled={props.disabled}
            onPress={() =>
              props.onChange(props.entries.filter((candidate) => candidate.rowId !== entry.rowId))
            }
          />
        </View>
      ))}
      <Button
        label={translator.message("settings.mcp.editor.add")}
        icon="plus"
        disabled={props.disabled}
        onPress={() =>
          props.onChange([
            ...props.entries,
            { rowId: uuidv4(), name: "", value: "", sensitive: false, valueRedacted: false },
          ])
        }
      />
    </View>
  );
}

export function McpServerEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly server: McpServerDefinition | null;
  readonly initialScope: ManagementScope;
  readonly existingIds: readonly string[];
  readonly projects: readonly EnvironmentProject[];
  readonly providers: readonly ServerProvider[];
  readonly onSaved: (result: McpMutationResult) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [draft, setDraft] = useState(() =>
    props.server
      ? mcpDraftFromServer(props.server)
      : { ...mcpDraftFromServer(null), ...props.initialScope },
  );
  const create = useManagementCommand(agentSettingsEnvironment.mcp.create);
  const update = useManagementCommand(agentSettingsEnvironment.mcp.update);
  const canSave = useAtomValue(
    (props.server
      ? agentSettingsEnvironment.mcp.update
      : agentSettingsEnvironment.mcp.create
    ).permissionAtom(props.environmentId),
  );
  const task = useManagementTask();
  const disabled = task.pending || !canSave;
  return (
    <View className="gap-5">
      <ManagementField
        label={translator.message("settings.mcp.editor.name")}
        value={draft.name}
        disabled={disabled}
        onChangeText={(name) => setDraft({ ...draft, name })}
      />
      <ManagementField
        label={translator.message("settings.mcp.editor.identifier")}
        value={draft.id}
        disabled={disabled || props.server !== null}
        onChangeText={(id) => setDraft({ ...draft, id })}
      />
      {props.server ? (
        <AppText className="text-xs text-foreground-muted">
          {translator.message("mobile.mcp.stableIdentifier")}
        </AppText>
      ) : null}
      <ManagementScopeFields
        value={draft}
        projects={props.projects}
        disabled={disabled}
        onChange={(scope) => setDraft({ ...draft, ...scope })}
      />
      <ManagementToggle
        label={translator.message("settings.mcp.editor.enabled")}
        value={draft.enabled}
        disabled={disabled}
        onChange={(enabled) => setDraft({ ...draft, enabled })}
      />
      <McpProviderRoutingFields
        value={draft.providerRouting}
        providers={props.providers}
        disabled={disabled}
        onChange={(providerRouting) => setDraft({ ...draft, providerRouting })}
      />
      <ManagementChoices
        label={translator.message("settings.mcp.editor.transport")}
        value={draft.transport}
        choices={[
          { value: "stdio", label: "stdio" },
          { value: "sse", label: "SSE" },
          { value: "http", label: "HTTP" },
        ]}
        disabled={disabled}
        onChange={(transport) => setDraft({ ...draft, transport })}
      />
      {draft.transport === "stdio" ? (
        <>
          <ManagementField
            label={translator.message("settings.mcp.editor.command")}
            value={draft.command}
            disabled={disabled}
            onChangeText={(command) => setDraft({ ...draft, command })}
          />
          <ManagementField
            label={translator.message("settings.mcp.editor.cwd")}
            value={draft.cwd}
            disabled={disabled}
            onChangeText={(cwd) => setDraft({ ...draft, cwd })}
          />
          <View className="gap-3">
            <AppText className="font-t3-medium text-foreground">
              {translator.message("settings.mcp.editor.arguments")}
            </AppText>
            {draft.args.map((argument, index) => (
              <View key={argument.rowId} className="gap-2">
                <ManagementField
                  label={translator.message("mobile.mcp.argument", { index: index + 1 })}
                  value={argument.value}
                  disabled={disabled}
                  onChangeText={(value) =>
                    setDraft({
                      ...draft,
                      args: draft.args.map((entry, position) =>
                        position === index ? { ...entry, value } : entry,
                      ),
                    })
                  }
                />
                <Button
                  label={translator.message("mobile.mcp.removeEntry")}
                  disabled={disabled}
                  tone="text"
                  onPress={() =>
                    setDraft({
                      ...draft,
                      args: draft.args.filter((_, position) => position !== index),
                    })
                  }
                />
              </View>
            ))}
            <Button
              label={translator.message("mobile.mcp.addArgument")}
              icon="plus"
              disabled={disabled}
              onPress={() =>
                setDraft({ ...draft, args: [...draft.args, { rowId: uuidv4(), value: "" }] })
              }
            />
          </View>
          <SecretEntriesEditor
            label={translator.message("settings.mcp.editor.environment")}
            entries={draft.env}
            disabled={disabled}
            onChange={(env) => setDraft({ ...draft, env })}
          />
        </>
      ) : (
        <>
          <ManagementField
            label={translator.message("settings.mcp.editor.url")}
            value={draft.url}
            disabled={disabled}
            onChangeText={(url) => setDraft({ ...draft, url })}
          />
          <SecretEntriesEditor
            label={translator.message("settings.mcp.editor.headers")}
            entries={draft.headers}
            disabled={disabled}
            onChange={(headers) => setDraft({ ...draft, headers })}
          />
        </>
      )}
      <ManagementError message={task.error} />
      <Button
        label={translator.message("settings.mcp.editor.save")}
        tone="primary"
        disabled={disabled}
        loading={task.pending}
        onPress={() =>
          void task.run(async () => {
            const server = mcpServerFromDraft(draft, props.existingIds, props.server?.id);
            const result = await (props.server ? update : create)({
              environmentId: props.environmentId,
              input: { server },
            });
            if (result) props.onSaved(result);
          })
        }
      />
    </View>
  );
}
