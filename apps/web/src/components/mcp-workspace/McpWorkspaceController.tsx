import type {
  EnvironmentId,
  McpRuntimeAction,
  McpRuntimeServer,
  McpRuntimeServerDetailsResult,
  McpRuntimeSnapshot,
  McpRuntimeContext,
  McpServerDefinition,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import type { RefObject } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ensureEnvironmentApi } from "~/environmentApi";
import { ensureLocalApi } from "~/localApi";
import { agentSettingsEnvironment } from "~/state/agentSettings";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

import type { ChatComposerHandle } from "../chat/ChatComposer";
import { McpServersSettingsPanel } from "../settings/McpServersSettings";
import {
  type McpRuntimeActionPending,
  McpRuntimeServerList,
  mcpRuntimeContextId,
  useMcpManagementRuntime,
} from "../mcp-management";
import { WorkspaceCardDrawerShell } from "../workspace-deck/WorkspaceCardDrawerShell";
import { McpWorkspaceCard } from "./McpWorkspaceCard";
import { McpWorkspacePanel, type McpWorkspaceSection } from "./McpWorkspacePanel";
import { McpWorkspacePeek } from "./McpWorkspacePeek";
import { deriveMcpWorkspaceProviderOptions, deriveMcpWorkspaceSummary } from "./mcpWorkspace.logic";

const MCP_DRAWER_STORAGE_KEY = "t3code:mcp-workspace-drawer-height:v1";

export interface McpWorkspaceCardControllerProps {
  readonly active: boolean;
  readonly authorizationAvailable: boolean;
  readonly configuredServers: readonly McpServerDefinition[];
  readonly environmentId: EnvironmentId;
  readonly expanded: boolean;
  readonly expansionBlocked: boolean;
  readonly projectCwd: string | null;
  readonly providerAccentColor?: string;
  readonly providerDisplayName: string;
  readonly providerDriver: ProviderDriverKind | null;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providers: readonly ServerProvider[];
  readonly runtimeSessionId: RuntimeSessionId | null;
  readonly threadId: ThreadId | null;
  readonly workspaceSupported: boolean;
  readonly composerRef?: RefObject<ChatComposerHandle | null>;
  readonly drawerAvailableHeight?: number;
  readonly onExpandedChange: (expanded: boolean) => void;
}

interface McpRuntimeWorkspaceState {
  readonly snapshot: McpRuntimeSnapshot | null;
  readonly error: string | null;
  readonly pending: boolean;
  readonly contexts: readonly McpRuntimeContext[];
  readonly selectedContext: McpRuntimeContext | undefined;
  readonly selectedContextId: string | null;
  readonly selectedProvider: ServerProvider | null;
  readonly selectContext: (contextId: string | null) => void;
  readonly selectProvider: (providerInstanceId: ProviderInstanceId) => void;
}

interface McpWorkspaceRuntimeProviderProps {
  readonly environmentId: EnvironmentId;
  readonly projectCwd: string | null;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly runtimeSessionId: RuntimeSessionId | null;
  readonly threadId: ThreadId | null;
  readonly workspaceSupported: boolean;
  readonly active: boolean;
  readonly expanded: boolean;
  readonly providers: readonly ServerProvider[];
  readonly children: React.ReactNode;
}

const EMPTY_RUNTIME: McpRuntimeWorkspaceState = {
  snapshot: null,
  error: null,
  pending: false,
  contexts: [],
  selectedContext: undefined,
  selectedContextId: null,
  selectedProvider: null,
  selectContext: () => {},
  selectProvider: () => {},
};
const McpWorkspaceRuntimeContext = createContext<McpRuntimeWorkspaceState>(EMPTY_RUNTIME);

export function McpWorkspaceRuntimeProvider(props: McpWorkspaceRuntimeProviderProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderInstanceId | null>(
    props.providerInstanceId,
  );
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedProviderId(props.providerInstanceId);
    setSelectedContextId(null);
  }, [
    props.environmentId,
    props.projectCwd,
    props.providerInstanceId,
    props.runtimeSessionId,
    props.threadId,
  ]);
  const selectedProvider =
    props.providers.find((provider) => provider.instanceId === selectedProviderId) ??
    props.providers.find((provider) => provider.instanceId === props.providerInstanceId) ??
    null;
  const providerInstanceId = selectedProvider?.instanceId ?? props.providerInstanceId;
  const selectedChatProvider = providerInstanceId === props.providerInstanceId;
  const enabled =
    props.workspaceSupported &&
    providerInstanceId !== null &&
    props.threadId !== null &&
    props.runtimeSessionId !== null;
  const inactiveRuntime = useEnvironmentQuery(
    enabled && !props.active && !props.expanded && selectedChatProvider
      ? agentSettingsEnvironment.mcp.runtimeProjection({
          environmentId: props.environmentId,
          input: {
            providerInstanceId,
            runtimeSessionId: props.runtimeSessionId,
            threadId: props.threadId,
          },
        })
      : null,
  );
  const managementRuntime = useMcpManagementRuntime({
    enabled: props.active || props.expanded,
    environmentId: props.environmentId,
    providerInstanceId,
    workspaceVersion: props.workspaceSupported ? 1 : undefined,
    selectedContextId,
    ...(selectedChatProvider && props.threadId
      ? { preferredThreadId: String(props.threadId) }
      : {}),
    ...(selectedChatProvider && props.runtimeSessionId
      ? { preferredRuntimeSessionId: String(props.runtimeSessionId) }
      : {}),
    requirePreferredExact: selectedChatProvider && selectedContextId === null,
  });
  const visible = props.active || props.expanded;
  const state = useMemo<McpRuntimeWorkspaceState>(
    () => ({
      snapshot: visible ? managementRuntime.snapshot : inactiveRuntime.data,
      error: visible
        ? (managementRuntime.runtimeError ?? managementRuntime.contextError)
        : inactiveRuntime.error,
      pending: visible ? managementRuntime.isLoading : inactiveRuntime.isPending,
      contexts: managementRuntime.contexts,
      selectedContext: managementRuntime.selectedContext,
      selectedContextId,
      selectedProvider,
      selectContext: setSelectedContextId,
      selectProvider: (nextProviderInstanceId) => {
        setSelectedProviderId(nextProviderInstanceId);
        setSelectedContextId(null);
      },
    }),
    [
      inactiveRuntime.data,
      inactiveRuntime.error,
      inactiveRuntime.isPending,
      managementRuntime.contextError,
      managementRuntime.contexts,
      managementRuntime.isLoading,
      managementRuntime.runtimeError,
      managementRuntime.selectedContext,
      managementRuntime.snapshot,
      selectedContextId,
      selectedProvider,
      visible,
    ],
  );
  return (
    <McpWorkspaceRuntimeContext.Provider value={state}>
      {props.children}
    </McpWorkspaceRuntimeContext.Provider>
  );
}

interface RuntimePanelProps {
  readonly authorizationAvailable: boolean;
  readonly readOnly: boolean;
  readonly environmentId: EnvironmentId;
  readonly providerDisplayName: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly projectCwd: string | null;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly runtime: McpRuntimeWorkspaceState;
  readonly threadId: ThreadId;
  readonly onManageServers: () => void;
}

function McpExactRuntimePanel(props: RuntimePanelProps) {
  const runRuntimeDetailsQuery = useAtomQueryRunner(
    agentSettingsEnvironment.mcp.runtimeServerDetailsQuery,
    { reportFailure: false },
  );
  const selector = useMemo(
    () => ({
      providerInstanceId: props.providerInstanceId,
      runtimeSessionId: props.runtimeSessionId,
      threadId: props.threadId,
    }),
    [props.providerInstanceId, props.runtimeSessionId, props.threadId],
  );
  const selectorKey = `${props.environmentId}\u0000${props.projectCwd ?? ""}\u0000${props.providerInstanceId}\u0000${props.threadId}\u0000${props.runtimeSessionId}`;
  const selectorKeyRef = useRef(selectorKey);
  selectorKeyRef.current = selectorKey;
  const [detailsByProviderKey, setDetailsByProviderKey] = useState<
    Readonly<Record<string, McpRuntimeServerDetailsResult | undefined>>
  >({});
  const [detailsLoadingKeys, setDetailsLoadingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [detailsErrorByProviderKey, setDetailsErrorByProviderKey] = useState<
    Readonly<Record<string, string | undefined>>
  >({});
  const [actionErrorByProviderKey, setActionErrorByProviderKey] = useState<
    Readonly<Record<string, string | undefined>>
  >({});
  const [pendingAction, setPendingAction] = useState<McpRuntimeActionPending | null>(null);

  useEffect(() => {
    setDetailsByProviderKey({});
    setDetailsLoadingKeys(new Set());
    setDetailsErrorByProviderKey({});
    setActionErrorByProviderKey({});
    setPendingAction(null);
  }, [selectorKey]);

  const loadDetails = useCallback(
    async (server: McpRuntimeServer, expanded: boolean) => {
      if (!expanded || detailsByProviderKey[server.providerKey]) return;
      if (detailsLoadingKeys.has(server.providerKey)) return;
      const requestSelectorKey = selectorKey;
      setDetailsLoadingKeys((current) => new Set(current).add(server.providerKey));
      setDetailsErrorByProviderKey((current) => ({
        ...current,
        [server.providerKey]: undefined,
      }));
      try {
        const result = await runRuntimeDetailsQuery({
          environmentId: props.environmentId,
          input: { ...selector, providerKey: server.providerKey },
        });
        if (result._tag === "Failure") throw Cause.squash(result.cause);
        if (selectorKeyRef.current !== requestSelectorKey) return;
        setDetailsByProviderKey((current) => ({
          ...current,
          [server.providerKey]: result.value,
        }));
      } catch (error) {
        if (selectorKeyRef.current !== requestSelectorKey) return;
        setDetailsErrorByProviderKey((current) => ({
          ...current,
          [server.providerKey]:
            error instanceof Error ? error.message : "MCP inventory unavailable.",
        }));
      } finally {
        if (selectorKeyRef.current === requestSelectorKey) {
          setDetailsLoadingKeys((current) => {
            const next = new Set(current);
            next.delete(server.providerKey);
            return next;
          });
        }
      }
    },
    [
      detailsByProviderKey,
      detailsLoadingKeys,
      props.environmentId,
      runRuntimeDetailsQuery,
      selector,
      selectorKey,
    ],
  );

  const performAction = useCallback(
    async (server: McpRuntimeServer, action: McpRuntimeAction) => {
      if (props.readOnly) {
        setActionErrorByProviderKey((current) => ({
          ...current,
          [server.providerKey]: "Runtime actions require operate access.",
        }));
        return;
      }
      if (action === "authorize" && !props.authorizationAvailable) {
        setActionErrorByProviderKey((current) => ({
          ...current,
          [server.providerKey]: "Complete authorization on the environment host.",
        }));
        return;
      }
      const requestSelectorKey = selectorKey;
      const nextPendingAction = { serverKey: server.providerKey, action };
      setPendingAction(nextPendingAction);
      setActionErrorByProviderKey((current) => ({
        ...current,
        [server.providerKey]: undefined,
      }));
      try {
        const result = await ensureEnvironmentApi(props.environmentId).mcp.runtimeAction({
          ...selector,
          providerKey: server.providerKey,
          action,
        });
        if (selectorKeyRef.current !== requestSelectorKey) return;
        if (!result.accepted) {
          throw new Error(result.message ?? `The ${action} action was not accepted.`);
        }
        if (result.authorizationUrl) {
          await ensureLocalApi().shell.openExternal(result.authorizationUrl);
        }
      } catch (error) {
        if (selectorKeyRef.current !== requestSelectorKey) return;
        setActionErrorByProviderKey((current) => ({
          ...current,
          [server.providerKey]: error instanceof Error ? error.message : "MCP action failed.",
        }));
      } finally {
        if (selectorKeyRef.current === requestSelectorKey) {
          setPendingAction((current) =>
            current?.serverKey === nextPendingAction.serverKey &&
            current.action === nextPendingAction.action
              ? null
              : current,
          );
        }
      }
    },
    [props.authorizationAvailable, props.environmentId, props.readOnly, selector, selectorKey],
  );

  return (
    <div className="mcp-workspace-runtime" data-mcp-runtime-session={props.runtimeSessionId}>
      <McpRuntimeServerList
        actionErrorByProviderKey={actionErrorByProviderKey}
        pendingAction={pendingAction}
        authorizationAvailable={props.authorizationAvailable}
        readOnly={props.readOnly}
        detailsByProviderKey={detailsByProviderKey}
        detailsErrorByProviderKey={detailsErrorByProviderKey}
        detailsLoadingKeys={detailsLoadingKeys}
        emptyMessage={
          props.runtime.error ??
          (props.runtime.pending
            ? "Loading this exact MCP runtime session…"
            : "This runtime session has ended or has no active MCP servers.")
        }
        providerDisplayName={props.providerDisplayName}
        servers={props.runtime.snapshot?.servers ?? []}
        onAction={(server, action) => void performAction(server, action)}
        onOpenSettings={props.onManageServers}
        onToggleDetails={(server, expanded) => void loadDetails(server, expanded)}
      />
    </div>
  );
}

function UpgradeRequired() {
  return (
    <div className="mcp-workspace-panel__empty" data-mcp-workspace-upgrade-required="true">
      <strong>Server upgrade required</strong>
      <p>
        Configuration remains available, but this server version cannot provide the MCP workspace
        runtime and context streams.
      </p>
    </div>
  );
}

function RuntimeUnavailable({
  selectedContextMissing,
}: {
  readonly selectedContextMissing: boolean;
}) {
  return (
    <div className="mcp-workspace-panel__empty">
      <strong>No exact runtime session</strong>
      <p>
        {selectedContextMissing
          ? "The selected runtime has ended or is no longer retained. Choose another exact session."
          : "Start a provider session to inspect connected servers, tools, resources, and templates."}
      </p>
    </div>
  );
}

function McpWorkspaceControllerView(props: McpWorkspaceCardControllerProps) {
  const runtime = useContext(McpWorkspaceRuntimeContext);
  const [activeSection, setActiveSection] = useState<McpWorkspaceSection>("servers");
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const sessionAccessQuery = useEnvironmentQuery(
    props.expanded
      ? agentSettingsEnvironment.mcp.sessionAccess({
          environmentId: props.environmentId,
          input: {},
        })
      : null,
  );
  const readOnly =
    sessionAccessQuery.data?.scopes !== undefined &&
    !sessionAccessQuery.data.scopes.includes("orchestration:operate");
  const selectedProvider = runtime.selectedProvider;
  const selectedProviderInstanceId = selectedProvider?.instanceId ?? props.providerInstanceId;
  const selectedProviderDisplayName =
    selectedProvider?.displayName ?? selectedProvider?.instanceId ?? props.providerDisplayName;
  const summary = deriveMcpWorkspaceSummary({
    configuredServers: props.configuredServers,
    projectCwd: props.projectCwd,
    providerInstanceId: selectedProviderInstanceId,
    runtimeSnapshot: runtime.snapshot,
    workspaceSupported: props.workspaceSupported,
  });
  const runtimeContent = !props.workspaceSupported ? (
    <UpgradeRequired />
  ) : selectedProviderInstanceId && runtime.selectedContext ? (
    <McpExactRuntimePanel
      authorizationAvailable={props.authorizationAvailable}
      readOnly={readOnly}
      environmentId={props.environmentId}
      providerDisplayName={selectedProviderDisplayName}
      providerInstanceId={selectedProviderInstanceId}
      projectCwd={props.projectCwd}
      runtimeSessionId={runtime.selectedContext.runtimeSessionId}
      runtime={runtime}
      threadId={runtime.selectedContext.threadId}
      onManageServers={() => setActiveSection("servers")}
    />
  ) : (
    <RuntimeUnavailable selectedContextMissing={runtime.selectedContextId !== null} />
  );
  const settingsSearch = {
    environment: String(props.environmentId),
    ...(selectedProviderInstanceId ? { provider: String(selectedProviderInstanceId) } : {}),
    ...(runtime.selectedContext ? { thread: String(runtime.selectedContext.threadId) } : {}),
    ...(runtime.selectedContext
      ? { runtime: String(runtime.selectedContext.runtimeSessionId) }
      : {}),
  };

  return (
    <McpWorkspaceCard
      expanded={props.expanded}
      expansionBlocked={props.expansionBlocked}
      expandButtonRef={expandButtonRef}
      providerDisplayName={selectedProviderDisplayName}
      providerDriver={selectedProvider?.driver ?? props.providerDriver}
      summary={summary}
      {...((selectedProvider?.accentColor ?? props.providerAccentColor) === undefined
        ? {}
        : { providerAccentColor: selectedProvider?.accentColor ?? props.providerAccentColor })}
      onExpand={() => props.onExpandedChange(true)}
      workbench={
        <WorkspaceCardDrawerShell
          activeTab={activeSection}
          ariaLabel="MCP workspace"
          collapseLabel="Collapse MCP workspace"
          resizeLabel="Resize MCP workspace vertically"
          storageKey={MCP_DRAWER_STORAGE_KEY}
          tabs={[]}
          title="MCP workspace"
          open={props.expanded}
          {...(props.drawerAvailableHeight === undefined
            ? {}
            : { availableHeight: props.drawerAvailableHeight })}
          className="mcp-workspace-drawer"
          dataAttributes={{
            "data-mcp-workspace-drawer": "true",
            "data-workspace-card-expanded-surface": "true",
          }}
          returnFocusRef={expandButtonRef}
          showTabs={false}
          onActiveTabChange={setActiveSection}
          onOpenChange={props.onExpandedChange}
        >
          <McpWorkspacePanel
            activeSection={activeSection}
            contexts={runtime.contexts.map((context) => ({
              id: mcpRuntimeContextId(context),
              label: `${context.state === "active" ? "Active" : "Ended"} · ${String(context.threadId).slice(0, 8)} · ${String(context.runtimeSessionId).slice(0, 8)}`,
            }))}
            providers={deriveMcpWorkspaceProviderOptions(props.providers)}
            selectedContextId={
              runtime.selectedContextId ??
              (runtime.selectedContext ? mcpRuntimeContextId(runtime.selectedContext) : null)
            }
            selectedProviderId={selectedProviderInstanceId}
            servers={
              <>
                {!props.workspaceSupported ? <UpgradeRequired /> : null}
                <McpServersSettingsPanel
                  embedded
                  showRuntimeSelector={false}
                  search={settingsSearch}
                  onProviderChange={runtime.selectProvider}
                />
              </>
            }
            runtime={runtimeContent}
            onActiveSectionChange={setActiveSection}
            onContextChange={runtime.selectContext}
            onProviderChange={(providerId) =>
              runtime.selectProvider(providerId as ProviderInstanceId)
            }
          />
        </WorkspaceCardDrawerShell>
      }
    />
  );
}

export function McpWorkspaceCardController(props: McpWorkspaceCardControllerProps) {
  return <McpWorkspaceControllerView {...props} />;
}

export function McpWorkspacePeekController(
  props: Pick<
    McpWorkspaceCardControllerProps,
    | "configuredServers"
    | "environmentId"
    | "projectCwd"
    | "providerDisplayName"
    | "providerInstanceId"
    | "runtimeSessionId"
    | "threadId"
    | "workspaceSupported"
  > & {
    readonly blocked: boolean;
    readonly position: "previous" | "next";
    readonly requestActivation: () => void;
  },
) {
  const runtime = useContext(McpWorkspaceRuntimeContext);
  const selectedProviderInstanceId =
    runtime.selectedProvider?.instanceId ?? props.providerInstanceId;
  const selectedProviderDisplayName =
    runtime.selectedProvider?.displayName ??
    runtime.selectedProvider?.instanceId ??
    props.providerDisplayName;
  const content = (runtime: McpRuntimeWorkspaceState) => (
    <McpWorkspacePeek
      blocked={props.blocked}
      position={props.position}
      providerDisplayName={selectedProviderDisplayName}
      summary={deriveMcpWorkspaceSummary({
        configuredServers: props.configuredServers,
        projectCwd: props.projectCwd,
        providerInstanceId: selectedProviderInstanceId,
        runtimeSnapshot: runtime.snapshot,
        workspaceSupported: props.workspaceSupported,
      })}
      requestActivation={props.requestActivation}
    />
  );
  return content(runtime);
}
