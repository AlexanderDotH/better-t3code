import type {
  EnvironmentId,
  McpRuntimeContext,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { agentSettingsEnvironment } from "../../state/agent-settings";
import { useEnvironmentQuery } from "../../state/query";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { RuntimeServerCard } from "../settings/mcp/McpRuntimePanel";
import { ThreadPanelSheet } from "./ThreadPanelSheet";
import { selectThreadMcpContext, threadMcpStatus } from "./threadMcpStatus";

export function ThreadMcpStrip(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
}) {
  const t = useMobileInterfaceTranslator();
  const [emptyOpen, setEmptyOpen] = useState(false);
  const contexts = useEnvironmentQuery(
    agentSettingsEnvironment.mcp.runtimeContextProjection({
      environmentId: props.environmentId,
      input: { providerInstanceId: props.providerInstanceId },
    }),
  );
  const context = selectThreadMcpContext(contexts.data?.contexts ?? [], props.threadId);
  // Providers without an MCP session never publish a context; only an error is worth a row.
  if (!context && !contexts.error) return null;
  if (!context)
    return (
      <>
        <Pressable
          accessibilityRole="button"
          onPress={() => setEmptyOpen(true)}
          className="px-4 py-2"
        >
          <AppText className="text-xs text-foreground-muted">
            {t.message("mobile.panels.mcp")} · {t.message("mobile.panels.error")}
          </AppText>
        </Pressable>
        {emptyOpen ? (
          <ThreadPanelSheet
            title={t.message("mobile.panels.mcp")}
            onClose={() => setEmptyOpen(false)}
          >
            <AppText selectable className="text-sm text-foreground-muted">
              {contexts.error ?? t.message("mobile.panels.noMcp")}
            </AppText>
            <Button label={t.message("common.retry")} onPress={contexts.refresh} />
          </ThreadPanelSheet>
        ) : null}
      </>
    );
  return (
    <ThreadMcpSession
      key={context.runtimeSessionId}
      environmentId={props.environmentId}
      context={context}
    />
  );
}

function ThreadMcpSession(props: {
  readonly environmentId: EnvironmentId;
  readonly context: McpRuntimeContext;
}) {
  const t = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
  const { providerInstanceId, threadId, runtimeSessionId } = props.context;
  const snapshot = useEnvironmentQuery(
    agentSettingsEnvironment.mcp.runtimeProjection({
      environmentId: props.environmentId,
      input: { providerInstanceId, threadId, runtimeSessionId },
    }),
  );
  const status = threadMcpStatus(snapshot.data?.servers ?? []);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between px-4 py-2"
      >
        <AppText className="text-xs text-foreground-muted">
          {t.message("mobile.panels.mcp")} ·{" "}
          {t.message(
            snapshot.error
              ? "mobile.panels.error"
              : snapshot.data === null
                ? "mobile.panels.connecting"
                : props.context.state === "inactive"
                  ? "mobile.panels.disconnected"
                  : "mobile.panels.connected",
          )}{" "}
          {status.connected}/{snapshot.data?.servers.length ?? 0}
        </AppText>
        <AppText className="text-xs text-foreground-muted">
          {status.attention > 0 ? `! ${status.attention} · ` : ""}
          {status.tools === null ? "?" : status.tools} {t.message("mobile.panels.tools")}
        </AppText>
      </Pressable>
      {open ? (
        <ThreadPanelSheet title={t.message("mobile.panels.mcp")} onClose={() => setOpen(false)}>
          {snapshot.error ? (
            <>
              <AppText selectable className="text-sm text-foreground-muted">
                {snapshot.error}
              </AppText>
              <Button label={t.message("common.retry")} onPress={snapshot.refresh} />
            </>
          ) : null}
          {snapshot.data?.servers.length === 0 ? (
            <AppText className="text-sm text-foreground-muted">
              {t.message("mobile.panels.noMcp")}
            </AppText>
          ) : null}
          {snapshot.data?.servers.map((server) => (
            <View key={server.providerKey}>
              <RuntimeServerCard environmentId={props.environmentId} server={server} />
            </View>
          ))}
        </ThreadPanelSheet>
      ) : null}
    </>
  );
}
