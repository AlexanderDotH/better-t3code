import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, McpMutationResult, McpServerDefinition } from "@t3tools/contracts";
import { isProviderInstanceEnabled } from "@t3tools/shared/serverSettings";
import { useState } from "react";
import { Alert, View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { ListRow } from "../../../components/ui/ListRow";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { agentSettingsEnvironment } from "../../../state/agent-settings";
import { useEnvironmentServerConfig, useProjects } from "../../../state/entities";
import { useEnvironmentQuery } from "../../../state/query";
import { SettingsSection } from "../components/SettingsSection";
import { ManagementError, ManagementScopeFields, ManagementToggle } from "./ManagementFields";
import { ManagementSheet } from "./ManagementSheet";
import { McpExportPanel, McpImportPanel } from "./McpImportExport";
import { McpRuntimePanel } from "./McpRuntimePanel";
import { McpServerEditor } from "./McpServerEditor";
import { EMPTY_MANAGEMENT_SCOPE, type ManagementScope } from "./mcp-form";
import { useManagementCommand, useManagementTask } from "./useManagementCommand";

type McpPage =
  | { readonly kind: "list" | "import" | "export" | "runtime" }
  | { readonly kind: "editor"; readonly server: McpServerDefinition | null };

export function McpSettingsEntry(props: { readonly environmentId: EnvironmentId }) {
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection title={translator.message("mobile.settings.agents.mcpServers")}>
      <ListRow
        label={translator.message("mobile.mcp.manageServers")}
        icon="server.rack"
        onPress={() => setOpen(true)}
      />
      {open ? (
        <McpManagementScreen environmentId={props.environmentId} onClose={() => setOpen(false)} />
      ) : null}
    </SettingsSection>
  );
}

function McpMutationNotice({ result }: { readonly result: McpMutationResult | null }) {
  const translator = useMobileInterfaceTranslator();
  if (!result) return null;
  return (
    <View className="gap-2 rounded-xl bg-subtle p-3">
      <AppText className="text-sm text-foreground">
        {translator.message("mobile.mcp.saved")}
      </AppText>
      {result.liveApplyResults.length === 0 ? (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("settings.mcp.runtime.appliesNextSession")}
        </AppText>
      ) : (
        result.liveApplyResults.map((entry) => (
          <AppText
            key={`${entry.threadId}:${entry.runtimeSessionId}`}
            className="text-sm text-foreground-muted"
          >
            {entry.providerInstanceId ?? ""}
            {" · "}
            {translator.message(`mobile.mcp.apply.${entry.outcome}`)}
            {entry.message ? ` · ${entry.message}` : ""}
          </AppText>
        ))
      )}
    </View>
  );
}

function McpManagementScreen(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const config = useEnvironmentServerConfig(props.environmentId);
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  const [scope, setScope] = useState<ManagementScope>(EMPTY_MANAGEMENT_SCOPE);
  const [page, setPage] = useState<McpPage>({ kind: "list" });
  const [notice, setNotice] = useState<McpMutationResult | null>(null);
  const native = useEnvironmentQuery(
    page.kind === "list"
      ? agentSettingsEnvironment.mcp.providerStatusQuery({
          environmentId: props.environmentId,
          input: {
            includeNative: true,
            scope: scope.scope,
            ...(scope.scope === "project" && scope.projectCwd.trim()
              ? { projectCwd: scope.projectCwd.trim() }
              : {}),
          },
        })
      : null,
  );
  const canCreate = useAtomValue(
    agentSettingsEnvironment.mcp.create.permissionAtom(props.environmentId),
  );
  const canUpdate = useAtomValue(
    agentSettingsEnvironment.mcp.update.permissionAtom(props.environmentId),
  );
  const canDelete = useAtomValue(
    agentSettingsEnvironment.mcp.delete.permissionAtom(props.environmentId),
  );
  const canToggle = useAtomValue(
    agentSettingsEnvironment.mcp.setEnabled.permissionAtom(props.environmentId),
  );
  const canImport = useAtomValue(
    agentSettingsEnvironment.mcp.importCursorJson.permissionAtom(props.environmentId),
  );
  const canExport = useAtomValue(
    agentSettingsEnvironment.mcp.exportCursorJson.permissionAtom(props.environmentId),
  );
  const setEnabled = useManagementCommand(agentSettingsEnvironment.mcp.setEnabled);
  const deleteServer = useManagementCommand(agentSettingsEnvironment.mcp.delete);
  const task = useManagementTask();
  const servers = config?.settings.mcp.servers ?? [];
  const visibleServers = servers.filter(
    (server) =>
      server.scope === scope.scope &&
      (scope.scope === "global" ||
        !scope.projectCwd.trim() ||
        server.projectCwd === scope.projectCwd.trim() ||
        (scope.projectId && server.projectId === scope.projectId)),
  );
  const nativeProviders = (native.data?.providers ?? []).filter(
    (provider) =>
      config &&
      isProviderInstanceEnabled(config.settings, provider.instanceId) &&
      (provider.nativeServers?.length ?? 0) > 0,
  );
  const saved = (result: McpMutationResult) => {
    setNotice(result);
    setPage({ kind: "list" });
  };
  const title = translator.message(
    page.kind === "editor"
      ? page.server
        ? "settings.mcp.editor.editTitle"
        : "settings.mcp.editor.newTitle"
      : page.kind === "import"
        ? "settings.mcp.import.title"
        : page.kind === "export"
          ? "settings.mcp.export.title"
          : page.kind === "runtime"
            ? "settings.mcp.runtime.status"
            : "mobile.settings.agents.mcpServers",
  );
  return (
    <ManagementSheet
      title={title}
      onClose={props.onClose}
      onBack={page.kind === "list" ? undefined : () => setPage({ kind: "list" })}
      busy={task.pending}
    >
      {page.kind === "editor" ? (
        <McpServerEditor
          environmentId={props.environmentId}
          server={page.server}
          initialScope={scope}
          existingIds={servers.map((server) => server.id)}
          projects={projects}
          providers={config?.providers ?? []}
          onSaved={saved}
        />
      ) : page.kind === "import" ? (
        <McpImportPanel
          environmentId={props.environmentId}
          initialScope={scope}
          projects={projects}
          providers={config?.providers ?? []}
          onImported={saved}
        />
      ) : page.kind === "export" ? (
        <McpExportPanel
          environmentId={props.environmentId}
          initialScope={scope}
          projects={projects}
          providers={config?.providers ?? []}
        />
      ) : page.kind === "runtime" ? (
        <McpRuntimePanel environmentId={props.environmentId} providers={config?.providers ?? []} />
      ) : (
        <>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={translator.message("settings.mcp.editor.newTitle")}
              icon="plus"
              disabled={!canCreate || !config || task.pending}
              onPress={() => setPage({ kind: "editor", server: null })}
            />
            <Button
              label={translator.message("settings.mcp.import.action")}
              disabled={!canImport || task.pending}
              onPress={() => setPage({ kind: "import" })}
            />
            <Button
              label={translator.message("mobile.mcp.export")}
              disabled={!canExport || task.pending}
              onPress={() => setPage({ kind: "export" })}
            />
            {(config?.environment.capabilities.mcpWorkspaceVersion ?? 0) >= 1 ? (
              <Button
                label={translator.message("settings.mcp.runtime.status")}
                disabled={task.pending}
                onPress={() => setPage({ kind: "runtime" })}
              />
            ) : null}
          </View>
          <ManagementScopeFields
            value={scope}
            projects={projects}
            onChange={setScope}
            disabled={task.pending}
          />
          <McpMutationNotice result={notice} />
          <ManagementError message={task.error} />
          {!config ? (
            <AppText className="text-sm text-foreground-muted">
              {translator.message("mobile.settings.agents.loadingMcp")}
            </AppText>
          ) : visibleServers.length === 0 && nativeProviders.length === 0 && !native.isPending ? (
            <AppText className="text-sm text-foreground-muted">
              {translator.message("mobile.settings.agents.noMcp")}
            </AppText>
          ) : null}
          {visibleServers.map((server) => (
            <View key={server.id} className="gap-3 rounded-xl border border-border-subtle p-4">
              <AppText className="text-base font-t3-semibold text-foreground">
                {server.name}
              </AppText>
              <AppText className="text-sm text-foreground-muted" selectable>
                {server.id}
                {" · "}
                {server.transport}
                {"\n"}
                {server.transport === "stdio"
                  ? [server.command, ...server.args].join(" ")
                  : server.url}
              </AppText>
              <AppText className="text-xs text-foreground-muted" selectable>
                {server.scope === "project"
                  ? (server.projectCwd ?? server.projectId)
                  : translator.message("settings.mcp.editor.global")}
              </AppText>
              <ManagementToggle
                label={translator.message("settings.mcp.editor.enabled")}
                value={server.enabled}
                disabled={!canToggle || task.pending}
                onChange={(enabled) =>
                  void task.run(async () => {
                    const result = await setEnabled({
                      environmentId: props.environmentId,
                      input: { id: server.id, enabled },
                    });
                    if (result) setNotice(result);
                  })
                }
              />
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label={translator.message("settings.mcp.action.edit")}
                  disabled={!canUpdate || task.pending}
                  onPress={() => setPage({ kind: "editor", server })}
                />
                <Button
                  label={translator.message("settings.mcp.action.delete")}
                  tone="danger"
                  disabled={!canDelete || task.pending}
                  onPress={() =>
                    Alert.alert(
                      translator.message("settings.mcp.action.delete"),
                      translator.message("mobile.mcp.deleteConfirm", { name: server.name }),
                      [
                        { text: translator.message("common.cancel"), style: "cancel" },
                        {
                          text: translator.message("settings.mcp.action.delete"),
                          style: "destructive",
                          onPress: () =>
                            void task.run(async () => {
                              const result = await deleteServer({
                                environmentId: props.environmentId,
                                input: { id: server.id },
                              });
                              if (result) setNotice(result);
                            }),
                        },
                      ],
                    )
                  }
                />
              </View>
            </View>
          ))}
          {nativeProviders.map((provider) => (
            <View
              key={provider.instanceId}
              className="gap-3 rounded-xl border border-border-subtle p-4"
            >
              <AppText className="font-t3-medium text-foreground">
                {config?.providers.find((entry) => entry.instanceId === provider.instanceId)
                  ?.displayName ?? provider.instanceId}
                {" · "}
                {translator.message("settings.mcp.workspace.providerManaged")}
              </AppText>
              {provider.message ? (
                <AppText className="text-sm text-foreground-muted">{provider.message}</AppText>
              ) : null}
              {provider.nativeServers?.map((server) => (
                <View key={`${server.configPath}:${server.name}`} className="gap-1">
                  <AppText className="text-base text-foreground">{server.name}</AppText>
                  <AppText className="text-sm text-foreground-muted">
                    {server.transport}
                    {" · "}
                    {translator.message(
                      server.enabled
                        ? "settings.mcp.runtime.state.not-started"
                        : "settings.mcp.runtime.state.disabled",
                    )}
                  </AppText>
                  <AppText className="text-xs text-foreground-muted" selectable>
                    {translator.message("settings.mcp.provider.discoveredIn", {
                      path: server.configPath,
                    })}
                  </AppText>
                </View>
              ))}
            </View>
          ))}
          <ManagementError message={native.error} />
          {native.isPending && native.data === null ? (
            <AppText className="text-sm text-foreground-muted">
              {translator.message("mobile.settings.agents.loadingMcp")}
            </AppText>
          ) : null}
          <Button
            label={translator.message("settings.mcp.action.refresh")}
            disabled={task.pending}
            onPress={native.refresh}
          />
        </>
      )}
    </ManagementSheet>
  );
}
