import type { OrchestrationSubagentDetailSnapshot, SubagentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient } from "effect/unstable/http";

import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
  type RemoteEnvironmentRequestError,
} from "../rpc/http.ts";
import { buildEnvironmentAuthHeaders, withEnvironmentCredentials } from "./environmentHttpAuth.ts";

const DEFAULT_SUBAGENT_SNAPSHOT_TIMEOUT_MS = 6_000;

export function environmentSubagentSnapshotPath(
  threadId: ThreadId,
  subagentId: SubagentId,
): string {
  return `/api/orchestration/threads/${encodeURIComponent(threadId)}/subagents/${encodeURIComponent(subagentId)}`;
}

/**
 * Load one subagent transcript over HTTP. The root thread snapshot intentionally
 * carries summaries only, so transcripts stay lazy even for highly parallel
 * sessions.
 */
export const fetchEnvironmentSubagentSnapshot = Effect.fn(
  "clientRuntime.state.fetchEnvironmentSubagentSnapshot",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly subagentId: SubagentId;
  readonly signer: Option.Option<ManagedRelayDpopSigner["Service"]>;
  readonly timeoutMs?: number;
}) {
  const requestUrl = environmentEndpointUrl(
    input.prepared.httpBaseUrl,
    environmentSubagentSnapshotPath(input.threadId, input.subagentId),
  );
  const client = yield* makeEnvironmentHttpApiClient(input.prepared.httpBaseUrl);
  const headers = yield* buildEnvironmentAuthHeaders(
    input.prepared.httpAuthorization,
    "GET",
    requestUrl,
    input.signer,
  );

  return yield* executeEnvironmentHttpRequest(
    requestUrl,
    input.timeoutMs ?? DEFAULT_SUBAGENT_SNAPSHOT_TIMEOUT_MS,
    withEnvironmentCredentials(
      input.prepared.httpAuthorization,
      client.orchestration.subagentSnapshot({
        params: {
          threadId: input.threadId,
          subagentId: input.subagentId,
        },
        headers,
      }),
    ),
  );
});

export type FetchEnvironmentSubagentSnapshotError = RemoteEnvironmentRequestError;

export class SubagentSnapshotLoader extends Context.Service<
  SubagentSnapshotLoader,
  {
    readonly load: (
      prepared: PreparedConnection,
      threadId: ThreadId,
      subagentId: SubagentId,
    ) => Effect.Effect<Option.Option<OrchestrationSubagentDetailSnapshot>>;
  }
>()("@t3tools/client-runtime/state/subagentSnapshotHttp/SubagentSnapshotLoader") {}

export const subagentSnapshotLoaderLayer: Layer.Layer<
  SubagentSnapshotLoader,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  SubagentSnapshotLoader,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);

    return SubagentSnapshotLoader.of({
      load: (prepared, threadId, subagentId) =>
        fetchEnvironmentSubagentSnapshot({
          prepared,
          threadId,
          subagentId,
          signer,
        }).pipe(
          Effect.map(Option.some<OrchestrationSubagentDetailSnapshot>),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.catchTags({
            EnvironmentResourceNotFoundError: () =>
              Effect.logDebug(
                "Subagent snapshot not found over HTTP; deferring to the socket subscription.",
              ).pipe(
                Effect.annotateLogs({ threadId, subagentId }),
                Effect.as(Option.none<OrchestrationSubagentDetailSnapshot>()),
              ),
          }),
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Could not load the subagent snapshot over HTTP; using the socket snapshot instead.",
            ).pipe(
              Effect.annotateLogs({
                threadId,
                subagentId,
                cause: Cause.pretty(cause),
              }),
              Effect.as(Option.none<OrchestrationSubagentDetailSnapshot>()),
            ),
          ),
        ),
    });
  }),
);
