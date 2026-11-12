import type { OrchestrationV2ThreadShell, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import type { ThreadStructure } from "@t3tools/client-runtime/state/models";
import {
  deriveThreadRelationshipGraph,
  immediateThreadRelationships,
} from "@t3tools/client-runtime/state/thread-relationships";
import {
  deriveWorkflowGroups,
  projectedSubagentsToRuntime,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { useMemo } from "react";
import { View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { ListRow } from "../../components/ui/ListRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ThreadWorkflowGroup } from "./ThreadWorkflowGroup";

export function ThreadDetailsRelationships(props: {
  readonly threadRef: ScopedThreadRef;
  readonly projection: ThreadStructure;
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly onOpen: (ref: ScopedThreadRef) => void;
}) {
  const t = useMobileInterfaceTranslator();
  const relationships = useMemo(() => {
    const graph = deriveThreadRelationshipGraph({
      threads: props.threads,
      projection: props.projection,
    });
    const ancestors: ThreadId[] = [];
    const seen = new Set<ThreadId>([props.threadRef.threadId]);
    let current = props.threadRef.threadId;
    while (true) {
      const parent = graph.edges.find(
        (edge) => edge.targetThreadId === current && edge.kind !== "transfer",
      )?.sourceThreadId;
      if (!parent || seen.has(parent)) break;
      ancestors.push(parent);
      seen.add(parent);
      current = parent;
    }
    const immediate = immediateThreadRelationships(graph, props.threadRef.threadId);
    return {
      graph,
      ancestors,
      children: immediate.filter(
        (row) =>
          row.edge.sourceThreadId === props.threadRef.threadId && row.edge.kind !== "transfer",
      ),
      transfers: immediate.filter((row) => row.edge.kind === "transfer"),
    };
  }, [props.threads, props.projection, props.threadRef.threadId]);
  const workflowGroups = useMemo(
    () => deriveWorkflowGroups(projectedSubagentsToRuntime(props.projection.subagents)),
    [props.projection.subagents],
  );
  const row = (id: ThreadId, description?: string) => (
    <ListRow
      key={id}
      icon="bubble.left.and.bubble.right"
      label={relationships.graph.nodes.get(id)?.thread?.title ?? id}
      description={description}
      onPress={() => props.onOpen({ environmentId: props.threadRef.environmentId, threadId: id })}
    />
  );
  return (
    <View className="gap-2">
      <AppText className="font-t3-semibold">{t.message("mobile.panels.relationships")}</AppText>
      {relationships.ancestors.length > 0 ? (
        <>
          <AppText className="text-xs text-foreground-muted">
            {t.message("mobile.panels.ancestry")}
          </AppText>
          {relationships.ancestors.map((id) => row(id))}
        </>
      ) : null}
      {relationships.children.length > 0 ? (
        <>
          <AppText className="text-xs text-foreground-muted">
            {t.message("mobile.panels.children")}
          </AppText>
          {relationships.children.map((entry) =>
            row(entry.threadId, entry.edge.status ?? undefined),
          )}
        </>
      ) : null}
      {relationships.transfers.map((entry) => row(entry.threadId, entry.edge.status ?? undefined))}
      {props.projection.thread.delegatedFrom ? (
        <ListRow
          icon="arrow.turn.left.up"
          label={props.projection.thread.delegatedFrom.title}
          onPress={() =>
            props.onOpen({
              environmentId: props.projection.thread.delegatedFrom!.environmentId,
              threadId: props.projection.thread.delegatedFrom!.threadId,
            })
          }
        />
      ) : null}
      {props.projection.subagents
        .flatMap((agent) => (agent.remoteChild ? [agent.remoteChild] : []))
        .map((child) => (
          <ListRow
            key={`${child.environmentId}:${child.threadId}`}
            icon="bubble.left.and.bubble.right"
            label={child.label}
            onPress={() =>
              props.onOpen({ environmentId: child.environmentId, threadId: child.threadId })
            }
          />
        ))}
      {workflowGroups.map((group) => {
        const subagent = props.projection.subagents.find((entry) => entry.id === group.workflow.id);
        return subagent ? (
          <ThreadWorkflowGroup
            key={subagent.id}
            environmentId={props.threadRef.environmentId}
            subagent={subagent}
            group={group}
            onOpen={(threadId) =>
              props.onOpen({ environmentId: props.threadRef.environmentId, threadId })
            }
          />
        ) : null;
      })}
    </View>
  );
}
