import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  HarnessChatSessionId,
  IsoDateTime,
  MessageId,
  OrchestrationProposedPlanId,
  ProjectId,
  ThreadId,
  type ChatAttachment,
  type HarnessChatActivity,
  type HarnessChatLink,
  type HarnessChatSyncError,
  type HarnessChatSyncRunInput,
  type HarnessChatSyncRunItem,
  type HarnessChatSyncRunResult,
  type ModelSelection,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  HarnessChatNativeMessageId,
  ProjectionHarnessChatSyncRepository,
  type ProjectionHarnessChatSyncLink,
} from "../persistence/Services/ProjectionHarnessChatSync.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";
import type { ProviderHistoryTranscript } from "../provider/Services/ProviderHistorySync.ts";
import {
  describeFailure,
  harnessSyncError,
  sessionSyncFailure,
  type SessionSyncFailure,
} from "./Errors.ts";
import type { HarnessHistoryDiscoveryShape } from "./HistoryDiscovery.ts";
import { makeHarnessChatSyncId } from "./Identifiers.ts";
import { resolveHarnessChatTargetProject } from "./ProjectTarget.ts";
import {
  findExistingHarnessMessageMatch,
  makeHarnessAttachmentPersistence,
  normalizeHistorySummary,
  normalizeIsoDateTime,
  normalizeOptionalText,
  type NormalizedHistorySummary,
} from "./TranscriptNormalization.ts";

interface ResolvedRunTarget {
  readonly projectId?: ProjectId | undefined;
  readonly create?:
    | {
        readonly rootPath: string;
        readonly suggestedName: string;
      }
    | undefined;
}

const isIsoDateTime = Schema.is(IsoDateTime);

export interface HarnessChatReconciliationShape {
  readonly run: (
    input: HarnessChatSyncRunInput,
  ) => Effect.Effect<HarnessChatSyncRunResult, HarnessChatSyncError>;
}

export const makeHarnessChatReconciliation = Effect.fn("makeHarnessChatReconciliation")(
  function* (input: {
    readonly discovery: HarnessHistoryDiscoveryShape;
    readonly now: Effect.Effect<IsoDateTime>;
  }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const orchestration = yield* OrchestrationEngineService;
    const projections = yield* ProjectionSnapshotQuery;
    const syncRepository = yield* ProjectionHarnessChatSyncRepository;
    const sessionDirectory = yield* ProviderSessionDirectory;
    const persistAttachment = yield* makeHarnessAttachmentPersistence();
    const discovery = input.discovery;
    const now = input.now;

    const resolveModelSelection = Effect.fn("HarnessChatSync.resolveModelSelection")(function* (
      instance: ProviderInstance,
      sourceModel: string | null,
    ): Effect.fn.Return<ModelSelection> {
      if (sourceModel) return { instanceId: instance.instanceId, model: sourceModel };
      const snapshot = yield* instance.snapshot.getSnapshot;
      const model =
        snapshot.models.find((candidate) => candidate.isDefault)?.slug ??
        snapshot.models[0]?.slug ??
        DEFAULT_MODEL_BY_PROVIDER[instance.driverKind] ??
        DEFAULT_MODEL;
      return { instanceId: instance.instanceId, model };
    });

    const run = Effect.fn("HarnessChatSync.run")(function* (request: HarnessChatSyncRunInput) {
      const group = yield* discovery.requireSource(request.sourceId);
      const selectedInstance = request.providerInstanceId
        ? group.instances.find(
            (instance) =>
              instance.instanceId === request.providerInstanceId &&
              instance.enabled &&
              instance.historySync.availability === "supported",
          )
        : group.preferred;
      if (!selectedInstance || selectedInstance.historySync.availability !== "supported") {
        return yield* harnessSyncError(
          "source-unavailable",
          "The selected provider instance cannot read this harness history.",
        );
      }
      const selectedHistory = selectedInstance.historySync;
      if (request.selection.mode === "only" && request.selection.sessionIds.length === 0) {
        return yield* harnessSyncError("invalid-selection", "Select at least one chat to sync.");
      }

      const fallbackTimestamp = yield* now;
      const nativeSummaries = yield* discovery
        .loadHistorySummaries(
          group,
          {
            query: request.selection.mode === "allMatching" ? request.selection.query : "",
            includeArchived:
              request.selection.mode === "allMatching" ? request.selection.includeArchived : true,
          },
          true,
        )
        .pipe(
          Effect.mapError((cause) =>
            harnessSyncError("source-unavailable", "Could not enumerate selected chats.", cause),
          ),
        );
      const summariesById = new Map(
        nativeSummaries.map((summary) => {
          const normalized = normalizeHistorySummary(summary, fallbackTimestamp);
          return [normalized.sessionId, normalized] as const;
        }),
      );
      let selectedSessionIds: ReadonlyArray<HarnessChatSessionId>;
      if (request.selection.mode === "allMatching") {
        const excluded = new Set(request.selection.excludedSessionIds);
        selectedSessionIds = nativeSummaries
          .map((summary) => HarnessChatSessionId.make(summary.sessionId.trim()))
          .filter((sessionId) => !excluded.has(sessionId));
      } else {
        selectedSessionIds = request.selection.sessionIds;
      }
      const uniqueSessionIds = [
        ...new Set(selectedSessionIds.map((sessionId) => HarnessChatSessionId.make(sessionId))),
      ];
      const links = yield* discovery.readLinks(group);
      const snapshot = yield* projections
        .getShellSnapshot()
        .pipe(
          Effect.mapError((cause) =>
            harnessSyncError("operation-failed", "Could not resolve target projects.", cause),
          ),
        );
      const projects: Array<Pick<OrchestrationProjectShell, "id" | "title" | "workspaceRoot">> =
        snapshot.projects.map((project) => ({
          id: project.id,
          title: project.title,
          workspaceRoot: project.workspaceRoot,
        }));
      const projectsById = new Map(projects.map((project) => [project.id, project]));
      const targetResolutions = new Map(
        request.targetResolutions.map((resolution) => [resolution.sessionId, resolution.projectId]),
      );

      const resolveTarget = Effect.fn("HarnessChatSync.resolveRunTarget")(function* (candidate: {
        readonly summary: NormalizedHistorySummary;
        readonly link: ProjectionHarnessChatSyncLink | undefined;
      }): Effect.fn.Return<ResolvedRunTarget, SessionSyncFailure> {
        if (candidate.link) return { projectId: candidate.link.projectId };
        const explicitProjectId = targetResolutions.get(candidate.summary.sessionId);
        if (explicitProjectId) {
          if (projectsById.has(explicitProjectId)) return { projectId: explicitProjectId };
          return yield* sessionSyncFailure({
            sessionId: candidate.summary.sessionId,
            code: "target-unresolved",
            message: "The selected target project is no longer available.",
            retryable: true,
          });
        }
        const automatic = yield* resolveHarnessChatTargetProject({
          cwd: candidate.summary.cwd,
          projects,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        );
        if (automatic.kind === "existing") return { projectId: automatic.projectId };
        if (automatic.kind === "create") {
          return {
            create: { rootPath: automatic.rootPath, suggestedName: automatic.suggestedName },
          };
        }
        if (
          request.unresolvedTargetProjectId &&
          projectsById.has(request.unresolvedTargetProjectId)
        ) {
          return { projectId: request.unresolvedTargetProjectId };
        }
        return yield* sessionSyncFailure({
          sessionId: candidate.summary.sessionId,
          code: "target-unresolved",
          message: "Choose a target project before synchronizing this chat.",
          retryable: true,
        });
      });

      const createTargetProject = Effect.fn("HarnessChatSync.createTargetProject")(
        function* (input: {
          readonly sessionId: HarnessChatSessionId;
          readonly create: NonNullable<ResolvedRunTarget["create"]>;
          readonly modelSelection: ModelSelection;
        }): Effect.fn.Return<ProjectId, SessionSyncFailure> {
          const normalizedRoot = path.resolve(input.create.rootPath);
          const existing = projects.find(
            (project) => path.resolve(project.workspaceRoot) === normalizedRoot,
          );
          if (existing) return existing.id;
          const projectId = ProjectId.make(makeHarnessChatSyncId("project", normalizedRoot));
          const dispatched = yield* Effect.result(
            orchestration.dispatch({
              type: "project.create",
              commandId: CommandId.make(makeHarnessChatSyncId("project-command", normalizedRoot)),
              projectId,
              title: input.create.suggestedName,
              workspaceRoot: normalizedRoot,
              createWorkspaceRootIfMissing: false,
              defaultModelSelection: input.modelSelection,
              createdAt: fallbackTimestamp,
            }),
          );
          if (Result.isFailure(dispatched)) {
            const concurrent = yield* Effect.result(
              projections.getActiveProjectByWorkspaceRoot(normalizedRoot),
            );
            if (Result.isSuccess(concurrent) && Option.isSome(concurrent.success)) {
              const project = concurrent.success.value;
              projects.push({
                id: project.id,
                title: project.title,
                workspaceRoot: project.workspaceRoot,
              });
              projectsById.set(project.id, project);
              return project.id;
            }
            return yield* sessionSyncFailure({
              sessionId: input.sessionId,
              code: "project-create-failed",
              message: describeFailure(dispatched.failure, "Could not create the target project."),
              retryable: true,
            });
          }
          const project = {
            id: projectId,
            title: input.create.suggestedName,
            workspaceRoot: normalizedRoot,
          };
          projects.push(project);
          projectsById.set(projectId, project);
          return projectId;
        },
      );

      const syncOne = Effect.fn("HarnessChatSync.syncOne")(function* (input: {
        readonly summary: NormalizedHistorySummary;
        readonly link: ProjectionHarnessChatSyncLink | undefined;
      }): Effect.fn.Return<HarnessChatSyncRunItem, SessionSyncFailure> {
        const target = yield* resolveTarget(input);
        const read = yield* Effect.result(
          selectedHistory.adapter.read({ sessionId: input.summary.sessionId }),
        );
        if (Result.isFailure(read)) {
          return yield* sessionSyncFailure({
            sessionId: input.summary.sessionId,
            code: "history-read-failed",
            message: describeFailure(read.failure, "Could not read the provider transcript."),
            retryable: true,
          });
        }
        const transcript: ProviderHistoryTranscript = read.success;
        if (transcript.sessionId.trim() !== input.summary.sessionId) {
          return yield* sessionSyncFailure({
            sessionId: input.summary.sessionId,
            code: "history-read-failed",
            message: "The provider returned a transcript for a different session.",
            retryable: false,
          });
        }

        const sourceUpdatedAt = normalizeIsoDateTime(transcript.updatedAt, input.summary.updatedAt);
        const modelSelection = yield* resolveModelSelection(
          selectedInstance,
          normalizeOptionalText(transcript.model) ?? input.summary.model,
        );
        const projectId = target.projectId
          ? target.projectId
          : yield* createTargetProject({
              sessionId: input.summary.sessionId,
              create: target.create!,
              modelSelection,
            });
        const created = input.link === undefined;
        const threadId =
          input.link?.threadId ??
          ThreadId.make(
            makeHarnessChatSyncId("thread", group.continuationKey, input.summary.sessionId),
          );
        const threadCreatedAt =
          input.summary.createdAt ??
          transcript.items.reduce<IsoDateTime | null>((earliest, item) => {
            const candidate =
              item.createdAt !== undefined && isIsoDateTime(item.createdAt) ? item.createdAt : null;
            if (candidate === null) return earliest;
            return earliest === null || candidate < earliest ? candidate : earliest;
          }, null) ??
          sourceUpdatedAt;
        if (created) {
          const threadCreated = yield* Effect.result(
            orchestration.dispatch({
              type: "thread.create",
              commandId: CommandId.make(
                makeHarnessChatSyncId(
                  "thread-command",
                  group.continuationKey,
                  input.summary.sessionId,
                ),
              ),
              threadId,
              projectId,
              title: input.summary.title,
              modelSelection,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
              branch: null,
              worktreePath: null,
              createdAt: threadCreatedAt,
            }),
          );
          if (Result.isFailure(threadCreated)) {
            return yield* sessionSyncFailure({
              sessionId: input.summary.sessionId,
              code: "sync-failed",
              message: describeFailure(threadCreated.failure, "Could not create the local chat."),
              retryable: true,
            });
          }
        }

        const existingMessageLinks = yield* Effect.result(
          syncRepository.listMessageLinksByThreadId({ threadId }),
        );
        if (Result.isFailure(existingMessageLinks)) {
          return yield* sessionSyncFailure({
            sessionId: input.summary.sessionId,
            code: "sync-failed",
            message: "Could not read existing native message mappings.",
            retryable: true,
          });
        }
        const importedNativeIds = new Set<string>(
          existingMessageLinks.success.map((entry) => entry.nativeMessageId),
        );
        const linkedMessageIds = new Set<MessageId>(
          existingMessageLinks.success.map((entry) => entry.messageId),
        );
        const hasUnmappedMessages = transcript.items.some(
          (item) =>
            item.kind === "message" &&
            item.nativeMessageId.trim().length > 0 &&
            !importedNativeIds.has(item.nativeMessageId.trim()),
        );
        let existingMessages: ReadonlyArray<OrchestrationMessage> = [];
        if (input.link && hasUnmappedMessages) {
          const detail = yield* Effect.result(projections.getThreadDetailById(threadId));
          if (Result.isFailure(detail)) {
            return yield* sessionSyncFailure({
              sessionId: input.summary.sessionId,
              code: "sync-failed",
              message: "Could not compare the native transcript with existing local messages.",
              retryable: true,
            });
          }
          existingMessages = Option.isSome(detail.success) ? detail.success.value.messages : [];
        }
        const claimedMessageIds = new Set<MessageId>();
        let messagesImported = 0;
        let attachmentsImported = 0;
        let attachmentsSkipped = 0;
        for (const item of transcript.items) {
          if (item.kind === "plan") {
            const nativePlanId = item.nativePlanId.trim();
            const planMarkdown = item.markdown.trim();
            if (!nativePlanId || !planMarkdown) continue;
            const planCreatedAt = normalizeIsoDateTime(item.createdAt, sourceUpdatedAt);
            const planUpdatedAt = normalizeIsoDateTime(item.updatedAt, planCreatedAt);
            const planned = yield* Effect.result(
              orchestration.dispatch({
                type: "thread.proposed-plan.upsert",
                commandId: CommandId.make(
                  makeHarnessChatSyncId(
                    "plan-command",
                    group.continuationKey,
                    input.summary.sessionId,
                    nativePlanId,
                  ),
                ),
                threadId,
                proposedPlan: {
                  id: OrchestrationProposedPlanId.make(
                    makeHarnessChatSyncId(
                      "plan",
                      group.continuationKey,
                      input.summary.sessionId,
                      nativePlanId,
                    ),
                  ),
                  turnId: null,
                  planMarkdown,
                  implementedAt: null,
                  implementationThreadId: null,
                  createdAt: planCreatedAt,
                  updatedAt: planUpdatedAt,
                },
                createdAt: planCreatedAt,
              }),
            );
            if (Result.isFailure(planned)) {
              return yield* sessionSyncFailure({
                sessionId: input.summary.sessionId,
                code: "sync-failed",
                message: describeFailure(planned.failure, "Could not import a provider plan."),
                retryable: true,
                messagesImported,
                attachmentsImported,
                attachmentsSkipped,
              });
            }
            continue;
          }

          const nativeMessageId = item.nativeMessageId.trim();
          if (!nativeMessageId || importedNativeIds.has(nativeMessageId)) continue;
          const existingMessage = findExistingHarnessMessageMatch({
            nativeMessageId,
            role: item.role,
            text: item.text,
            messages: existingMessages,
            linkedMessageIds,
            claimedMessageIds,
          });
          if (existingMessage) {
            const linked = yield* Effect.result(
              orchestration.dispatch({
                type: "thread.harness-sync.message.import",
                commandId: CommandId.make(
                  makeHarnessChatSyncId(
                    "message-link-command",
                    group.continuationKey,
                    input.summary.sessionId,
                    nativeMessageId,
                  ),
                ),
                threadId,
                nativeMessageId,
                message: existingMessage,
                linkedAt: fallbackTimestamp,
              }),
            );
            if (Result.isFailure(linked)) {
              return yield* sessionSyncFailure({
                sessionId: input.summary.sessionId,
                code: "sync-failed",
                message: describeFailure(
                  linked.failure,
                  "Could not link an existing local message to the native transcript.",
                ),
                retryable: true,
                messagesImported,
                attachmentsImported,
                attachmentsSkipped,
              });
            }
            importedNativeIds.add(nativeMessageId);
            claimedMessageIds.add(existingMessage.id);
            continue;
          }
          const persistedAttachments = yield* Effect.forEach(
            item.attachments,
            (attachment) =>
              persistAttachment({
                threadId,
                sourceId: group.sourceId,
                nativeMessageId,
                attachment,
              }),
            { concurrency: 1 },
          );
          const availableAttachments = persistedAttachments.filter(
            (attachment): attachment is ChatAttachment => attachment !== null,
          );
          attachmentsImported += availableAttachments.length;
          attachmentsSkipped += item.attachments.length - availableAttachments.length;
          const messageCreatedAt = normalizeIsoDateTime(item.createdAt, sourceUpdatedAt);
          const messageUpdatedAt = normalizeIsoDateTime(item.updatedAt, messageCreatedAt);
          const imported = yield* Effect.result(
            orchestration.dispatch({
              type: "thread.harness-sync.message.import",
              commandId: CommandId.make(
                makeHarnessChatSyncId(
                  "message-command",
                  group.continuationKey,
                  input.summary.sessionId,
                  nativeMessageId,
                ),
              ),
              threadId,
              nativeMessageId,
              message: {
                id:
                  item.role === "assistant"
                    ? MessageId.make(`assistant:${nativeMessageId}`)
                    : MessageId.make(
                        makeHarnessChatSyncId(
                          "message",
                          group.continuationKey,
                          input.summary.sessionId,
                          nativeMessageId,
                        ),
                      ),
                role: item.role,
                text: item.text,
                ...(availableAttachments.length > 0 ? { attachments: availableAttachments } : {}),
                turnId: null,
                streaming: false,
                createdAt: messageCreatedAt,
                updatedAt: messageUpdatedAt,
              },
              linkedAt: fallbackTimestamp,
            }),
          );
          if (Result.isFailure(imported)) {
            return yield* sessionSyncFailure({
              sessionId: input.summary.sessionId,
              code: "sync-failed",
              message: describeFailure(imported.failure, "Could not import a provider message."),
              retryable: true,
              messagesImported,
              attachmentsImported,
              attachmentsSkipped,
            });
          }
          importedNativeIds.add(HarnessChatNativeMessageId.make(nativeMessageId));
          messagesImported += 1;
        }

        const resumed = yield* Effect.result(
          selectedHistory.adapter.resumeCursor({ sessionId: input.summary.sessionId }),
        );
        if (Result.isFailure(resumed)) {
          return yield* sessionSyncFailure({
            sessionId: input.summary.sessionId,
            code: "resume-bind-failed",
            message: describeFailure(
              resumed.failure,
              "Could not prepare the native resume cursor.",
            ),
            retryable: true,
            messagesImported,
            attachmentsImported,
            attachmentsSkipped,
          });
        }
        let activity: HarnessChatActivity = "unknown";
        const checkActivity = selectedHistory.adapter.checkActivity;
        if (checkActivity) {
          const checked = yield* Effect.result(
            checkActivity({ sessionId: input.summary.sessionId }),
          );
          activity = Result.isSuccess(checked)
            ? checked.success
            : (input.link?.activity ?? "unknown");
        }
        const owningInstanceId: ProviderInstanceId =
          input.link?.providerInstanceId ?? selectedInstance.instanceId;
        const owningInstance = group.instances.find(
          (instance) => instance.instanceId === owningInstanceId,
        );
        const providerLabel =
          input.link?.providerLabel ?? selectedInstance.displayName?.trim() ?? group.label;
        const bound = yield* Effect.result(
          sessionDirectory.upsert({
            threadId,
            provider: owningInstance?.driverKind ?? selectedInstance.driverKind,
            providerInstanceId: owningInstanceId,
            ...(resumed.success.adapterKey === undefined
              ? {}
              : { adapterKey: resumed.success.adapterKey }),
            status: "stopped",
            resumeCursor: resumed.success.resumeCursor,
            ...(resumed.success.runtimePayload === undefined
              ? {}
              : { runtimePayload: resumed.success.runtimePayload }),
            runtimeMode: DEFAULT_RUNTIME_MODE,
          }),
        );
        if (Result.isFailure(bound)) {
          return yield* sessionSyncFailure({
            sessionId: input.summary.sessionId,
            code: "resume-bind-failed",
            message: describeFailure(bound.failure, "Could not persist the native resume binding."),
            retryable: true,
            messagesImported,
            attachmentsImported,
            attachmentsSkipped,
          });
        }

        const lastSyncedAt = yield* now;
        const linked = yield* Effect.result(
          orchestration.dispatch({
            type: "thread.harness-sync.link",
            commandId: CommandId.make(
              makeHarnessChatSyncId(
                "link-command",
                group.continuationKey,
                input.summary.sessionId,
                sourceUpdatedAt,
                activity,
                lastSyncedAt,
              ),
            ),
            threadId,
            sourceId: group.sourceId,
            continuationKey: group.continuationKey,
            nativeSessionId: input.summary.sessionId,
            providerInstanceId: owningInstanceId,
            providerLabel,
            activity,
            sourceUpdatedAt,
            lastSyncedAt,
          }),
        );
        if (Result.isFailure(linked)) {
          return yield* sessionSyncFailure({
            sessionId: input.summary.sessionId,
            code: "sync-failed",
            message: describeFailure(linked.failure, "Could not link the native harness session."),
            retryable: true,
            messagesImported,
            attachmentsImported,
            attachmentsSkipped,
          });
        }

        const link: HarnessChatLink = {
          sourceId: group.sourceId,
          nativeSessionId: input.summary.sessionId,
          threadId,
          projectId,
          providerInstanceId: owningInstanceId,
          providerLabel,
          activity,
          sourceUpdatedAt,
          lastSyncedAt,
        };
        return {
          sessionId: input.summary.sessionId,
          threadId,
          projectId,
          created,
          messagesImported,
          attachmentsImported,
          attachmentsSkipped,
          link,
        };
      });

      const outcomes = yield* Effect.forEach(
        uniqueSessionIds,
        (sessionId) => {
          const summary = summariesById.get(sessionId);
          if (!summary) {
            return Effect.succeed(
              Result.fail(
                sessionSyncFailure({
                  sessionId,
                  code: "session-unavailable",
                  message: "That provider session is no longer available.",
                  retryable: true,
                }),
              ),
            );
          }
          return Effect.result(syncOne({ summary, link: links.get(sessionId) }));
        },
        { concurrency: 1 },
      );
      const successful = outcomes.filter(Result.isSuccess).map((outcome) => outcome.success);
      const failed = outcomes.filter(Result.isFailure).map((outcome) => outcome.failure);
      const messagesImported =
        successful.reduce((total, item) => total + item.messagesImported, 0) +
        failed.reduce((total, item) => total + item.messagesImported, 0);
      const attachmentsImported =
        successful.reduce((total, item) => total + item.attachmentsImported, 0) +
        failed.reduce((total, item) => total + item.attachmentsImported, 0);
      const attachmentsSkipped =
        successful.reduce((total, item) => total + item.attachmentsSkipped, 0) +
        failed.reduce((total, item) => total + item.attachmentsSkipped, 0);
      return {
        selectedCount: uniqueSessionIds.length,
        syncedCount: successful.length,
        failedCount: failed.length,
        threadsCreated: successful.filter((item) => item.created).length,
        threadsUpdated: successful.filter((item) => !item.created).length,
        messagesImported,
        attachmentsImported,
        attachmentsSkipped,
        items: successful,
        failures: failed.map((item) => item.failure),
      };
    });

    return { run } satisfies HarnessChatReconciliationShape;
  },
);
