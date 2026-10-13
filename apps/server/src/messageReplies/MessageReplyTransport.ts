import type { ProviderTurnTranscriptHandoff } from "@t3tools/contracts";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import type { ProviderService } from "../provider/Services/ProviderService.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import type { ActiveMessageReply } from "./MessageReplyState.ts";

const STOP_TIMEOUT = Duration.seconds(5);

export function makeMessageReplyTransport(dependencies: {
  readonly providerService: ProviderService["Service"];
  readonly resourceGovernor?: ResourceProtection.SubagentResourceGovernor["Service"];
}) {
  const { providerService, resourceGovernor } = dependencies;
  const target = (run: ActiveMessageReply) => ({
    threadId: run.syntheticThreadId,
    runtimeSessionId: run.runtimeSessionId,
    providerInstanceId: run.topic.summary.messageReply.modelSelection.instanceId,
  });
  const abortTarget = (run: ActiveMessageReply) => ({ ...target(run), turnId: run.turnId });
  const release = (run: ActiveMessageReply) =>
    resourceGovernor?.cancelThread(run.syntheticThreadId) ?? Effect.void;

  const awaitAdmission = (run: ActiveMessageReply) =>
    (run.topic.providerDriver
      ? resourceGovernor?.awaitAdmission({
          threadId: run.syntheticThreadId,
          provider: run.topic.providerDriver,
          providerInstanceId: run.topic.summary.messageReply.modelSelection.instanceId,
          configurationKey: ResourceProtection.resourceConfigurationKey([
            "message-reply",
            run.topic.providerDriver,
            run.topic.summary.messageReply.modelSelection,
          ]),
        })
      : undefined) ?? Effect.succeed(true);

  const start = (run: ActiveMessageReply) => {
    const inherited = run.topic.summary.messageReply;
    return providerService.startTransientSession(
      run.syntheticThreadId,
      {
        threadId: run.syntheticThreadId,
        runtimeSessionId: run.runtimeSessionId,
        purpose: "subagent-worker",
        providerInstanceId: inherited.modelSelection.instanceId,
        cwd: inherited.workspacePath,
        modelSelection: inherited.modelSelection,
        runtimeMode: inherited.runtimeMode,
        freshSession: true,
      },
      {
        workspaceContextThreadId: run.topic.parentThreadId,
        mcpMode: "full",
        messageReply: { replyTopicId: run.topic.id, interactionMode: inherited.interactionMode },
      },
    );
  };

  const send = (run: ActiveMessageReply, handoff: ProviderTurnTranscriptHandoff) =>
    providerService.sendTurn({
      threadId: run.syntheticThreadId,
      ...(run.job.message.text.trim().length > 0
        ? {
            input: projectComposerContextForProvider({
              text: run.job.message.text,
              records: run.job.message.context?.records ?? [],
            }),
          }
        : {}),
      ...(run.job.message.attachments ? { attachments: run.job.message.attachments } : {}),
      transcriptHandoff: handoff,
      modelSelection: run.topic.summary.messageReply.modelSelection,
      interactionMode: run.topic.summary.messageReply.interactionMode,
    });

  const interrupt = Effect.fn("MessageReplyTransport.interrupt")(function* (
    run: ActiveMessageReply,
  ) {
    yield* release(run);
    if (!run.sessionStarted) return;
    yield* providerService.interruptAbortTarget(abortTarget(run)).pipe(
      Effect.timeoutOption(STOP_TIMEOUT),
      Effect.catchCause((cause) =>
        Effect.logWarning("Reply interruption failed", {
          replyTopicId: run.topic.id,
          cause: Cause.pretty(cause),
        }),
      ),
      Effect.asVoid,
    );
  });

  const cleanup = Effect.fn("MessageReplyTransport.cleanup")(function* (run: ActiveMessageReply) {
    yield* release(run);
    if (!run.sessionStarted) return;
    const stopped = yield* providerService
      .stopTransientSession(target(run))
      .pipe(Effect.exit, Effect.timeoutOption(STOP_TIMEOUT));
    if (Option.isNone(stopped) || Exit.isFailure(stopped.value)) {
      yield* providerService.forceStopAbortTarget(abortTarget(run)).pipe(
        Effect.timeoutOption(STOP_TIMEOUT),
        Effect.catchCause((cause) =>
          Effect.logWarning("Reply runtime cleanup failed", {
            replyTopicId: run.topic.id,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    }
    run.sessionStarted = false;
  });

  return { awaitAdmission, start, send, interrupt, cleanup };
}
