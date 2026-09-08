import {
  CommandId,
  HarnessChatSessionId,
  HarnessChatSyncError,
  type HarnessChatActivity,
  type HarnessChatSyncListInput,
  type HarnessChatSyncListResult,
  type HarnessChatSyncRunInput,
  type HarnessChatSyncRunResult,
  type HarnessChatSyncSourceId,
  type HarnessChatSyncSourcesResult,
  type HarnessChatSyncStatusInput,
  type HarnessChatSyncStatusResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionHarnessChatSyncRepository } from "./persistence/Services/ProjectionHarnessChatSync.ts";
import { harnessSyncError } from "./harnessChatSync/Errors.ts";
import { makeHarnessHistoryDiscovery } from "./harnessChatSync/HistoryDiscovery.ts";
import { makeHarnessChatSyncId } from "./harnessChatSync/Identifiers.ts";
import { makeHarnessChatReconciliation } from "./harnessChatSync/Reconciliation.ts";
import {
  isHarnessChatChanged,
  normalizeHistorySummary,
  toPublicHarnessChatLink,
} from "./harnessChatSync/TranscriptNormalization.ts";

export {
  makeHarnessChatSyncId,
  makeHarnessChatSyncAttachmentId,
} from "./harnessChatSync/Identifiers.ts";
export { resolveHarnessChatTargetProject } from "./harnessChatSync/ProjectTarget.ts";
export { findExistingHarnessMessageMatch } from "./harnessChatSync/TranscriptNormalization.ts";

export interface HarnessChatSyncShape {
  readonly sources: Effect.Effect<HarnessChatSyncSourcesResult, HarnessChatSyncError>;
  readonly list: (
    input: HarnessChatSyncListInput,
  ) => Effect.Effect<HarnessChatSyncListResult, HarnessChatSyncError>;
  readonly run: (
    input: HarnessChatSyncRunInput,
  ) => Effect.Effect<HarnessChatSyncRunResult, HarnessChatSyncError>;
  readonly status: (
    input: HarnessChatSyncStatusInput,
  ) => Effect.Effect<HarnessChatSyncStatusResult, HarnessChatSyncError>;
}

export const makeHarnessChatSync = Effect.fn("makeHarnessChatSync")(function* () {
  const orchestration = yield* OrchestrationEngineService;
  const syncRepository = yield* ProjectionHarnessChatSyncRepository;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const discovery = yield* makeHarnessHistoryDiscovery({ now });
  const reconciliation = yield* makeHarnessChatReconciliation({ discovery, now });

  const status: HarnessChatSyncShape["status"] = Effect.fn("HarnessChatSync.status")(
    function* (input) {
      let sourceId: HarnessChatSyncSourceId;
      let requestedSessionIds: ReadonlyArray<HarnessChatSessionId>;
      if ("threadId" in input) {
        const linked = yield* syncRepository
          .getLinkByThreadId({ threadId: input.threadId })
          .pipe(
            Effect.mapError((cause) =>
              harnessSyncError("operation-failed", "Could not read the harness chat link.", cause),
            ),
          );
        if (Option.isNone(linked)) return { statuses: [] };
        sourceId = linked.value.sourceId;
        requestedSessionIds = [linked.value.nativeSessionId];
      } else {
        sourceId = input.sourceId;
        requestedSessionIds = input.sessionIds;
      }

      const group = yield* discovery.requireSource(sourceId);
      const instance = group.preferred;
      if (!instance || instance.historySync.availability !== "supported") {
        return yield* harnessSyncError(
          "source-unavailable",
          "No enabled provider instance can read that harness history source.",
        );
      }
      const sessionIds = [
        ...new Set(requestedSessionIds.map((sessionId) => HarnessChatSessionId.make(sessionId))),
      ];
      const fallbackTimestamp = yield* now;
      const summaries = yield* discovery
        .loadHistorySummariesForSessions(group, sessionIds)
        .pipe(
          Effect.mapError((cause) =>
            harnessSyncError("source-unavailable", "Could not refresh harness chat status.", cause),
          ),
        );
      const summariesById = new Map(
        summaries.map((summary) => [
          HarnessChatSessionId.make(summary.sessionId.trim()),
          normalizeHistorySummary(summary, fallbackTimestamp),
        ]),
      );
      const links = yield* discovery.readLinks(group);
      const statuses = yield* Effect.forEach(
        sessionIds,
        Effect.fn("HarnessChatSync.refreshOneStatus")(function* (sessionId) {
          const summary = summariesById.get(sessionId);
          const existingLink = links.get(sessionId);
          let activity: HarnessChatActivity = existingLink?.activity ?? "unknown";
          if (instance.historySync.availability === "supported") {
            const checkActivity = instance.historySync.adapter.checkActivity;
            if (checkActivity) {
              const checked = yield* Effect.result(checkActivity({ sessionId }));
              if (Result.isSuccess(checked)) activity = checked.success;
            } else {
              activity = "unknown";
            }
          }

          let publicLink = existingLink ? toPublicHarnessChatLink(existingLink) : null;
          if (existingLink && existingLink.activity !== activity) {
            const dispatched = yield* Effect.result(
              orchestration.dispatch({
                type: "thread.harness-sync.link",
                commandId: CommandId.make(
                  makeHarnessChatSyncId(
                    "status",
                    group.continuationKey,
                    sessionId,
                    activity,
                    fallbackTimestamp,
                  ),
                ),
                threadId: existingLink.threadId,
                sourceId: existingLink.sourceId,
                continuationKey: existingLink.continuationKey,
                nativeSessionId: existingLink.nativeSessionId,
                providerInstanceId: existingLink.providerInstanceId,
                providerLabel: existingLink.providerLabel,
                activity,
                // Activity refreshes must not advance the imported source
                // watermark or hide newly arrived provider messages.
                sourceUpdatedAt: existingLink.sourceUpdatedAt,
                lastSyncedAt: existingLink.lastSyncedAt,
              }),
            );
            if (Result.isFailure(dispatched)) {
              return yield* harnessSyncError(
                "operation-failed",
                "Could not persist the refreshed harness activity status.",
                dispatched.failure,
              );
            }
            publicLink = toPublicHarnessChatLink({ ...existingLink, activity });
          }

          return {
            sessionId,
            activity,
            sourceUpdatedAt: summary?.updatedAt ?? null,
            hasChanges: summary ? isHarnessChatChanged(summary.updatedAt, existingLink) : false,
            link: publicLink,
          };
        }),
        { concurrency: 4 },
      );
      return { statuses };
    },
  );

  return {
    sources: discovery.sources,
    list: discovery.list,
    run: reconciliation.run,
    status,
  } satisfies HarnessChatSyncShape;
});
