import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { deriveLatestContextWindowSnapshot } from "@t3tools/client-runtime/context-window";
import { summarizeThreadTokenUsage } from "@t3tools/client-runtime/thread-token-usage";
import { projectedSubagentsToRuntime } from "@t3tools/client-runtime/state/subagentRuntime";
import {
  EDITORS,
  type DiscoveredLocalServer,
  type ScheduledTask,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import * as Dialog from "../../components/ui/Dialog";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useEnvironmentServerConfig, useProject, useThreadShell } from "../../state/entities";
import { environmentSnapshotAtom } from "../../state/shell";
import { useQuietThreadStructure, useThreadWorktreePath } from "../../state/use-thread-detail";
import { serverEnvironment } from "../../state/server";
import { previewEnvironment } from "../../state/preview";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { ThreadPanelSheet } from "./ThreadPanelSheet";
import { ThreadDetailsRelationships } from "./ThreadDetailsRelationships";
import { useOpenLinkedThread } from "./useOpenLinkedThread";
import { threadPanelServers } from "./threadPanelServers";
import { threadPanelShell } from "./threadPanelCommands";

export function ThreadDetailsPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly onClose: () => void;
}) {
  const t = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const { environmentId, threadId } = props.threadRef;
  const config = useEnvironmentServerConfig(environmentId);
  const thread = useThreadShell(props.threadRef);
  const project = useProject(thread ? { environmentId, projectId: thread.projectId } : null);
  const worktreePath = useThreadWorktreePath(props.threadRef);
  const cwd = worktreePath ?? thread?.worktreePath ?? project?.workspaceRoot ?? null;
  const projection = useQuietThreadStructure(props.threadRef)?.projection ?? null;
  const shell = useAtomValue(environmentSnapshotAtom(environmentId));
  const openLinkedThread = useOpenLinkedThread();
  const usage = useMemo(() => {
    if (!projection) return null;
    const context = deriveLatestContextWindowSnapshot(projection);
    return {
      context,
      totals: summarizeThreadTokenUsage(context, projectedSubagentsToRuntime(projection.subagents)),
    };
  }, [projection]);
  const discovered = useEnvironmentQuery(
    previewEnvironment.discoveredServers({ environmentId, input: {} }),
  );
  const servers = threadPanelServers(discovered.data?.servers ?? [], threadId);
  const tasks = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const boundTasks = (tasks.data?.tasks ?? []).filter((task) => task.threadId === threadId);
  const openPreview = useAtomCommand(previewEnvironment.open);
  const stopServer = useAtomCommand(previewEnvironment.stopLocalServer);
  const runTask = useAtomCommand(serverEnvironment.runScheduledTaskNow);
  const setTaskEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled);
  const openEditor = useAtomCommand(threadPanelShell.openInEditor);
  const canPreview = useAtomValue(previewEnvironment.open.permissionAtom(environmentId));
  const canStop = useAtomValue(previewEnvironment.stopLocalServer.permissionAtom(environmentId));
  const canRun = useAtomValue(serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId));
  const canToggle = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const canOpenEditor = useAtomValue(threadPanelShell.openInEditor.permissionAtom(environmentId));
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const perform = async (operation: () => Promise<{ readonly _tag: string }>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    await (async () => {
      if ((await operation())._tag === "Failure") Dialog.alert(t.message("mobile.panels.failed"));
    })().finally(() => {
      busy.current = false;
      setPending(false);
    });
  };
  const openServer = (server: DiscoveredLocalServer) =>
    void perform(async () => {
      const result = await openPreview({
        environmentId,
        input: { threadId, url: server.url, runtime: "server" },
      });
      if (result._tag === "Success") {
        props.onClose();
        navigation.navigate("ThreadBrowserPreview", {
          environmentId,
          threadId,
          tabId: result.value.tabId,
        });
      }
      return result;
    });
  const stop = (server: DiscoveredLocalServer) => {
    if (!canStop || server.pid === null) return;
    const pid = server.pid;
    Dialog.confirm({
      title: t.message("mobile.panels.stopServer"),
      message: `${server.url}\n${t.message("mobile.panels.stopServerHint")}`,
      confirmText: t.message("mobile.panels.stopServer"),
      destructive: true,
      onConfirm: () =>
        void perform(() => stopServer({ environmentId, input: { pid, port: server.port } })),
    });
  };
  const toggleTask = (task: ScheduledTask, enabled: boolean) =>
    void perform(() => setTaskEnabled({ environmentId, input: { id: task.id, enabled } }));
  const openThread = (ref: ScopedThreadRef) => {
    props.onClose();
    openLinkedThread(ref);
  };
  return (
    <ThreadPanelSheet title={t.message("mobile.panels.details")} onClose={props.onClose}>
      <AppText className="font-t3-semibold">{t.message("mobile.panels.workspace")}</AppText>
      <AppText selectable className="text-sm text-foreground-muted">
        {project?.title}
        {cwd ? `\n${cwd}` : ""}
        {thread?.branch ? `\n${thread.branch}` : ""}
      </AppText>
      {cwd && config?.availableEditors.length ? (
        <>
          <AppText className="text-sm font-t3-medium">
            {t.message("mobile.panels.openEditor")}
          </AppText>
          {config.availableEditors.map((editor) => (
            <ListRow
              key={editor}
              icon="desktopcomputer"
              label={EDITORS.find((entry) => entry.id === editor)?.label ?? editor}
              disabled={!canOpenEditor || pending}
              onPress={() =>
                void perform(() => openEditor({ environmentId, input: { cwd, editor } }))
              }
            />
          ))}
        </>
      ) : null}
      {project ? (
        <ListRow
          icon="terminal"
          label={t.message("mobile.panels.scripts")}
          onPress={() => {
            props.onClose();
            navigation.navigate("SettingsProjectScripts", { environmentId, projectId: project.id });
          }}
        />
      ) : null}
      {projection ? (
        <ThreadDetailsRelationships
          threadRef={props.threadRef}
          projection={projection}
          threads={shell?.threads ?? []}
          onOpen={openThread}
        />
      ) : null}
      <AppText className="font-t3-semibold">{t.message("mobile.panels.localServers")}</AppText>
      {discovered.error ? (
        <AppText selectable className="text-sm text-foreground-muted">
          {discovered.error}
        </AppText>
      ) : null}
      {servers.length === 0 ? (
        <AppText className="text-sm text-foreground-muted">
          {t.message("mobile.panels.noServers")}
        </AppText>
      ) : (
        servers.map((server) => (
          <View key={`${server.pid}:${server.host}:${server.port}`} className="gap-2">
            <ListRow
              icon="globe"
              label={server.url}
              description={[
                server.terminal
                  ? t.message("mobile.git.terminal")
                  : t.message("mobile.panels.agent"),
                server.processName,
                server.pid,
              ]
                .filter(Boolean)
                .join(" · ")}
              disabled={!canPreview || pending}
              onPress={() => openServer(server)}
            />
            {canStop && config?.environment.capabilities.localServerStop && server.pid !== null ? (
              <Button
                label={t.message("mobile.panels.stopServer")}
                tone="danger"
                disabled={pending}
                onPress={() => stop(server)}
              />
            ) : null}
          </View>
        ))
      )}
      <AppText className="font-t3-semibold">{t.message("mobile.panels.automations")}</AppText>
      {tasks.error ? (
        <AppText selectable className="text-sm text-foreground-muted">
          {tasks.error}
        </AppText>
      ) : null}
      {boundTasks.length === 0 ? (
        <AppText className="text-sm text-foreground-muted">
          {t.message("mobile.panels.noAutomations")}
        </AppText>
      ) : (
        boundTasks.map((task) => (
          <View key={task.id} className="gap-2 rounded-xl border border-border-subtle p-3">
            <AppText className="font-t3-medium">{task.title}</AppText>
            <AppText className="text-xs text-foreground-muted">
              {t.message(`mobile.panels.task.${task.lastRunStatus}`)}
              {task.nextRunAt
                ? ` · ${t.date(new Date(task.nextRunAt), { hour: "numeric", minute: "2-digit" })}`
                : ""}
            </AppText>
            {task.blockedByPolicy ? (
              <AppText className="text-sm text-foreground-muted">{task.blockedByPolicy}</AppText>
            ) : null}
            <SettingsSwitchRow
              icon="clock"
              label={t.message("mobile.panels.enabled")}
              value={task.enabled}
              disabled={!canToggle || pending}
              onValueChange={(enabled) => toggleTask(task, enabled)}
            />
            <Button
              label={t.message("mobile.panels.runNow")}
              disabled={
                !canRun ||
                pending ||
                task.lastRunStatus === "running" ||
                task.blockedByPolicy !== undefined
              }
              onPress={() => void perform(() => runTask({ environmentId, input: { id: task.id } }))}
            />
          </View>
        ))
      )}
      <AppText className="font-t3-semibold">{t.message("mobile.panels.usage")}</AppText>
      {usage ? (
        <View className="gap-2">
          <AppText className="text-sm text-foreground-muted">
            {t.message("chat.timeline.inputTokens")}: {t.number(usage.totals.inputTokens)} ·{" "}
            {t.message("chat.timeline.outputTokens")}: {t.number(usage.totals.outputTokens)}
          </AppText>
          {usage.context ? (
            <>
              <AppText className="text-sm text-foreground-muted">
                {t.message("chat.contextMeter.usedTokens")}: {t.number(usage.context.usedTokens)}
                {usage.context.maxTokens ? ` / ${t.number(usage.context.maxTokens)}` : ""}
              </AppText>
              {usage.context.usedPercentage !== null ? (
                <AppText className="text-sm text-foreground-muted">
                  {t.message("chat.contextMeter.percentage")}:{" "}
                  {t.number(usage.context.usedPercentage)}%
                </AppText>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </ThreadPanelSheet>
  );
}
