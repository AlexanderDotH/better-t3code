import { useAtomValue } from "@effect/atom-react";
import { mcpRuntimeServerDetailsKey } from "@t3tools/client-runtime/mcp";
import type {
  EnvironmentId,
  McpRuntimeAction,
  McpRuntimeContext,
  McpRuntimeServer,
  McpRuntimeServerDetailsInput,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { useState } from "react";
import { Linking, View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { agentSettingsEnvironment } from "../../../state/agent-settings";
import { useEnvironmentQuery } from "../../../state/query";
import { ManagementChoices, ManagementError } from "./ManagementFields";
import { useManagementCommand, useManagementTask } from "./useManagementCommand";

function RuntimeActionButton(props: {
  readonly environmentId: EnvironmentId;
  readonly target: McpRuntimeServerDetailsInput;
  readonly action: McpRuntimeAction;
  readonly pending: boolean;
  readonly onPress: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const allowed = useAtomValue(
    agentSettingsEnvironment.mcp.runtimeAction.permissionAtom(props.environmentId, {
      ...props.target,
      action: props.action,
    }),
  );
  return (
    <Button
      label={translator.message(`settings.mcp.action.${props.action}`)}
      disabled={!allowed || props.pending}
      onPress={props.onPress}
    />
  );
}

export function RuntimeServerCard(props: {
  readonly environmentId: EnvironmentId;
  readonly server: McpRuntimeServer;
}) {
  return (
    <RuntimeServerCardContents
      key={mcpRuntimeServerDetailsKey({ ...props.server, environmentId: props.environmentId })}
      {...props}
    />
  );
}

function RuntimeServerCardContents(props: {
  readonly environmentId: EnvironmentId;
  readonly server: McpRuntimeServer;
}) {
  const translator = useMobileInterfaceTranslator();
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const target = {
    providerInstanceId: props.server.providerInstanceId,
    threadId: props.server.threadId,
    runtimeSessionId: props.server.runtimeSessionId,
    providerKey: props.server.providerKey,
  };
  const details = useEnvironmentQuery(
    expanded
      ? agentSettingsEnvironment.mcp.runtimeServerDetailsQuery({
          environmentId: props.environmentId,
          input: target,
        })
      : null,
  );
  const runAction = useManagementCommand(agentSettingsEnvironment.mcp.runtimeAction);
  const task = useManagementTask();
  return (
    <View className="gap-3 rounded-xl border border-border-subtle p-4">
      <AppText className="font-t3-semibold text-foreground">{props.server.name}</AppText>
      <AppText className="text-sm text-foreground-muted">
        {translator.message(`settings.mcp.runtime.state.${props.server.state}`)}
      </AppText>
      <AppText className="text-xs text-foreground-muted">
        {translator.message(
          props.server.source === "t3-managed"
            ? "settings.mcp.runtime.source.t3Managed"
            : props.server.source === "provider-native"
              ? "settings.mcp.runtime.source.providerManaged"
              : "settings.mcp.runtime.source.system",
        )}
      </AppText>
      {props.server.issue ? <ManagementError message={props.server.issue.message} /> : null}
      {props.server.state === "auth-required" &&
      !props.server.availableActions.includes("authorize") ? (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("settings.mcp.runtime.authorizeOnHost")}
        </AppText>
      ) : null}
      {props.server.configDrift !== "none" ? (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("settings.mcp.runtime.appliesNextSession")}
        </AppText>
      ) : null}
      {props.server.toolCount !== undefined ? (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("settings.mcp.runtime.toolCount", {
            count: props.server.toolCount,
            formattedCount: translator.number(props.server.toolCount),
          })}
        </AppText>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {props.server.availableActions.map((action) => (
          <RuntimeActionButton
            key={action}
            environmentId={props.environmentId}
            target={target}
            action={action}
            pending={task.pending}
            onPress={() =>
              void task.run(async () => {
                const result = await runAction({
                  environmentId: props.environmentId,
                  input: { ...target, action },
                });
                if (!result) return;
                setNotice(
                  result.message ??
                    (result.accepted
                      ? null
                      : translator.message("settings.mcp.toast.actionFailed")),
                );
                setAuthorizationUrl(result.authorizationUrl ?? null);
                if (expanded) details.refresh();
              })
            }
          />
        ))}
        <Button
          label={translator.message(
            expanded ? "mobile.mcp.hideInventory" : "mobile.mcp.showInventory",
          )}
          tone="text"
          onPress={() => setExpanded(!expanded)}
        />
      </View>
      {notice ? <AppText className="text-sm text-foreground-muted">{notice}</AppText> : null}
      {authorizationUrl ? (
        <Button
          label={translator.message("mobile.mcp.openAuthorization")}
          disabled={task.pending}
          onPress={() =>
            void task.run(async () => {
              await Linking.openURL(authorizationUrl);
            })
          }
        />
      ) : null}
      <ManagementError message={task.error} />
      {expanded ? (
        <View className="gap-3">
          {details.isPending ? (
            <AppText className="text-sm text-foreground-muted">
              {translator.message("settings.mcp.runtime.loadingInventory")}
            </AppText>
          ) : null}
          <ManagementError message={details.error} />
          {details.error ? (
            <Button
              label={translator.message("settings.mcp.action.refresh")}
              onPress={details.refresh}
            />
          ) : null}
          {details.data ? (
            <>
              <AppText className="font-t3-medium text-foreground">
                {translator.message("settings.mcp.runtime.tools")}
              </AppText>
              {details.data.tools.length === 0 ? (
                <AppText className="text-sm text-foreground-muted">
                  {translator.message("settings.mcp.runtime.noTools")}
                </AppText>
              ) : null}
              {details.data.tools.map((tool) => (
                <View key={tool.name} className="gap-1">
                  <AppText className="text-sm font-t3-medium text-foreground">
                    {tool.title ?? tool.name}
                  </AppText>
                  {tool.description ? (
                    <AppText className="text-sm text-foreground-muted">{tool.description}</AppText>
                  ) : null}
                </View>
              ))}
              {details.data.resources.length > 0 ? (
                <AppText className="font-t3-medium text-foreground">
                  {translator.message("settings.mcp.runtime.resources")}
                </AppText>
              ) : null}
              {details.data.resources.map((resource) => (
                <AppText key={resource.uri} className="text-sm text-foreground-muted" selectable>
                  {resource.title ?? resource.name}
                  {"\n"}
                  {resource.uri}
                </AppText>
              ))}
              {details.data.templates.length > 0 ? (
                <AppText className="font-t3-medium text-foreground">
                  {translator.message("settings.mcp.runtime.resourceTemplates")}
                </AppText>
              ) : null}
              {details.data.templates.map((template) => (
                <AppText
                  key={template.uriTemplate}
                  className="text-sm text-foreground-muted"
                  selectable
                >
                  {template.title ?? template.name}
                  {"\n"}
                  {template.uriTemplate}
                </AppText>
              ))}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function RuntimeSession(props: {
  readonly environmentId: EnvironmentId;
  readonly context: McpRuntimeContext;
}) {
  const translator = useMobileInterfaceTranslator();
  const snapshot = useEnvironmentQuery(
    agentSettingsEnvironment.mcp.runtimeProjection({
      environmentId: props.environmentId,
      input: {
        providerInstanceId: props.context.providerInstanceId,
        threadId: props.context.threadId,
        runtimeSessionId: props.context.runtimeSessionId,
      },
    }),
  );
  return (
    <View className="gap-3">
      <ManagementError message={snapshot.error} />
      {snapshot.error ? (
        <Button
          label={translator.message("settings.mcp.action.refresh")}
          onPress={snapshot.refresh}
        />
      ) : null}
      {snapshot.data === null && snapshot.isPending ? (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("mobile.settings.agents.loadingMcp")}
        </AppText>
      ) : null}
      {snapshot.data?.servers.length === 0 ? (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("settings.mcp.runtime.empty")}
        </AppText>
      ) : null}
      {snapshot.data?.servers.map((server) => (
        <RuntimeServerCard
          key={server.providerKey}
          environmentId={props.environmentId}
          server={server}
        />
      ))}
    </View>
  );
}

function ProviderRuntime(props: {
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId;
}) {
  const translator = useMobileInterfaceTranslator();
  const [selection, setSelection] = useState<string | null>(null);
  const contexts = useEnvironmentQuery(
    agentSettingsEnvironment.mcp.runtimeContextProjection({
      environmentId: props.environmentId,
      input: { providerInstanceId: props.providerInstanceId },
    }),
  );
  const contextKey = (context: McpRuntimeContext) =>
    JSON.stringify([context.threadId, context.runtimeSessionId]);
  const selectedContext =
    selection === null
      ? (contexts.data?.contexts.find((context) => context.state === "active") ??
        contexts.data?.contexts[0])
      : contexts.data?.contexts.find((context) => contextKey(context) === selection);
  return (
    <View className="gap-4">
      <ManagementError message={contexts.error} />
      <Button
        label={translator.message("settings.mcp.action.refresh")}
        onPress={contexts.refresh}
      />
      {contexts.isPending && contexts.data === null ? (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("mobile.settings.agents.loadingMcp")}
        </AppText>
      ) : null}
      {contexts.data?.contexts.length === 0 || (selection !== null && !selectedContext) ? (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("mobile.mcp.noSessions")}
        </AppText>
      ) : null}
      {contexts.data && contexts.data.contexts.length > 0 ? (
        <ManagementChoices
          label={translator.message("mobile.mcp.session")}
          value={selectedContext ? contextKey(selectedContext) : ""}
          choices={contexts.data.contexts.map((context) => ({
            value: contextKey(context),
            label: context.threadTitle ?? context.threadId,
          }))}
          onChange={setSelection}
        />
      ) : null}
      {selectedContext ? (
        <RuntimeSession
          key={contextKey(selectedContext)}
          environmentId={props.environmentId}
          context={selectedContext}
        />
      ) : null}
    </View>
  );
}

export function McpRuntimePanel(props: {
  readonly environmentId: EnvironmentId;
  readonly providers: readonly ServerProvider[];
}) {
  const translator = useMobileInterfaceTranslator();
  const [providerId, setProviderId] = useState<ProviderInstanceId | null>(null);
  const selectedProvider =
    props.providers.find((provider) => provider.instanceId === providerId) ?? props.providers[0];
  return (
    <View className="gap-5">
      <ManagementChoices
        label={translator.message("settings.mcp.editor.enableFor")}
        value={selectedProvider?.instanceId ?? ""}
        choices={props.providers.map((provider) => ({
          value: provider.instanceId,
          label: provider.displayName ?? provider.instanceId,
        }))}
        onChange={(id) => setProviderId(id as ProviderInstanceId)}
      />
      {selectedProvider ? (
        <ProviderRuntime
          key={selectedProvider.instanceId}
          environmentId={props.environmentId}
          providerInstanceId={selectedProvider.instanceId}
        />
      ) : (
        <AppText className="text-sm text-foreground-muted">
          {translator.message("mobile.mcp.noProviders")}
        </AppText>
      )}
    </View>
  );
}
