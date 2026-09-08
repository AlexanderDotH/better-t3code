import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { type Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentSubscriptionAtomFamily,
} from "./runtime.ts";
import {
  EMPTY_KNOWLEDGE_GRAPH_CLIENT_STATE,
  applyKnowledgeGraphStreamEvent,
} from "../knowledgeGraphState.ts";

const KNOWLEDGE_GRAPH_IDLE_TTL_MS = 60_000;

const scopeCommandKey = (target: {
  readonly environmentId: string;
  readonly input: { readonly scope?: { readonly projectId: string; readonly threadId?: string } };
}) =>
  JSON.stringify([
    target.environmentId,
    target.input.scope?.projectId ?? null,
    target.input.scope?.threadId ?? null,
  ]);

export function createKnowledgeGraphEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const mutationScheduler = createAtomCommandScheduler();
  const mutationConcurrency = { mode: "serial" as const, key: scopeCommandKey };

  return {
    state: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:knowledge-graph:state",
      idleTtlMs: KNOWLEDGE_GRAPH_IDLE_TTL_MS,
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.knowledgeGraphSubscribe>) =>
        subscribe(WS_METHODS.knowledgeGraphSubscribe, input).pipe(
          Stream.scan(EMPTY_KNOWLEDGE_GRAPH_CLIENT_STATE, applyKnowledgeGraphStreamEvent),
        ),
    }),
    query: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:knowledge-graph:query",
      tag: WS_METHODS.knowledgeGraphQuery,
      staleTimeMs: 5_000,
      idleTtlMs: KNOWLEDGE_GRAPH_IDLE_TTL_MS,
    }),
    nodeContent: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:knowledge-graph:node-content",
      tag: WS_METHODS.knowledgeGraphNodeContent,
      staleTimeMs: 30_000,
      idleTtlMs: KNOWLEDGE_GRAPH_IDLE_TTL_MS,
    }),
    rebuild: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:knowledge-graph:rebuild",
      tag: WS_METHODS.knowledgeGraphRebuild,
      scheduler: mutationScheduler,
      concurrency: mutationConcurrency,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:knowledge-graph:cancel",
      tag: WS_METHODS.knowledgeGraphCancel,
      scheduler: mutationScheduler,
      concurrency: mutationConcurrency,
    }),
    pause: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:knowledge-graph:pause",
      tag: WS_METHODS.knowledgeGraphPause,
      scheduler: mutationScheduler,
      concurrency: mutationConcurrency,
    }),
    clear: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:knowledge-graph:clear",
      tag: WS_METHODS.knowledgeGraphClear,
      scheduler: mutationScheduler,
      concurrency: {
        mode: "serial" as const,
        key: (target) =>
          target.input.target === "environment"
            ? JSON.stringify([target.environmentId, "environment"])
            : JSON.stringify([
                target.environmentId,
                target.input.scope.projectId,
                target.input.scope.threadId ?? null,
              ]),
      },
    }),
  } as const;
}

export * from "../knowledgeGraphState.ts";
