import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import { isMessageReplyTopicActive } from "@t3tools/client-runtime/messageReplies";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  OrchestrationSubagentSummary,
  OrchestrationThreadActivity,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { RotateCcwIcon, SquareIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import type { PendingUserInput } from "../../session-logic";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";

export function ReplyTopicControls({
  threadRef,
  topic,
  activities,
  enabled,
}: {
  threadRef: ScopedThreadRef;
  topic: OrchestrationSubagentSummary;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  enabled: boolean;
}) {
  const translate = useInterfaceTranslator().message;
  const interrupt = useAtomCommand(threadEnvironment.interruptReply, { reportFailure: false });
  const retry = useAtomCommand(threadEnvironment.retryReply, { reportFailure: false });
  const respondToApproval = useAtomCommand(threadEnvironment.respondToReplyApproval, {
    reportFailure: false,
  });
  const respondToInput = useAtomCommand(threadEnvironment.respondToReplyUserInput, {
    reportFailure: false,
  });
  const dismissInput = useAtomCommand(threadEnvironment.dismissReplyUserInput, {
    reportFailure: false,
  });
  const pending = useMemo(
    () =>
      derivePendingRequests(activities.filter((activity) => activity.replyTopicId === topic.id)),
    [activities, topic.id],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = { threadId: threadRef.threadId, replyTopicId: topic.id };
  const run = async (command: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    if (busy || !enabled) return;
    setBusy(true);
    setError(null);
    try {
      const result = await command();
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : translate("chat.reply.sendFailed"));
    } finally {
      setBusy(false);
    }
  };
  const active = isMessageReplyTopicActive(topic);
  const failed = topic.status === "error" || topic.status === "unavailable";
  const status = topic.status === "starting" ? "pending" : failed ? "failed" : topic.status;

  return (
    <div className="mt-2 space-y-2 text-xs" data-reply-topic-id={topic.id}>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground" role="status">
        <span>{translate(`chat.reply.status.${status}`)}</span>
        {active ? (
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={!enabled || busy}
            onClick={() =>
              void run(() => interrupt({ environmentId: threadRef.environmentId, input }))
            }
          >
            <SquareIcon />
            {translate("chat.reply.stop")}
          </Button>
        ) : failed || topic.status === "interrupted" ? (
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={!enabled || busy}
            onClick={() => void run(() => retry({ environmentId: threadRef.environmentId, input }))}
          >
            <RotateCcwIcon />
            {translate("chat.reply.retry")}
          </Button>
        ) : null}
      </div>
      {error || (failed && topic.statusMessage) ? (
        <p className="text-destructive" role="alert">
          {error ?? topic.statusMessage}
        </p>
      ) : null}
      {pending.approvals.map((approval) => (
        <div
          key={approval.requestId}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
        >
          <ComposerPendingApprovalPanel
            approval={approval}
            pendingCount={pending.approvals.length}
          />
          <ComposerPendingApprovalActions
            requestId={approval.requestId}
            options={approval.options}
            isResponding={!enabled || busy}
            onRespondToApproval={(requestId, decision) =>
              run(() =>
                respondToApproval({
                  environmentId: threadRef.environmentId,
                  input: { ...input, requestId, decision },
                }),
              )
            }
          />
        </div>
      ))}
      {pending.userInputs.map((request) => (
        <ReplyTopicQuestion
          key={request.requestId}
          request={request}
          disabled={!enabled || busy}
          onRespond={(answers) =>
            run(() =>
              respondToInput({
                environmentId: threadRef.environmentId,
                input: { ...input, requestId: request.requestId, answers },
              }),
            )
          }
          onDismiss={() =>
            run(() =>
              dismissInput({
                environmentId: threadRef.environmentId,
                input: { ...input, requestId: request.requestId },
              }),
            )
          }
        />
      ))}
    </div>
  );
}

function ReplyTopicQuestion({
  request,
  disabled,
  onRespond,
  onDismiss,
}: {
  request: PendingUserInput;
  disabled: boolean;
  onRespond: (answers: Record<string, string | string[]>) => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const translate = useInterfaceTranslator().message;
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const answers = buildPendingUserInputAnswers(request.questions, drafts);
  return (
    <form
      className="space-y-3 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (answers) void onRespond(answers);
      }}
    >
      {request.questions.map((question) => (
        <fieldset key={question.id} className="space-y-2" disabled={disabled}>
          <legend className="mb-2 font-medium">{question.question}</legend>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => {
              const value = option.value ?? option.label;
              const selected = drafts[question.id]?.selectedOptionValues?.includes(value) ?? false;
              return (
                <Button
                  key={value}
                  type="button"
                  size="xs"
                  variant={selected ? "secondary" : "outline"}
                  aria-pressed={selected}
                  title={option.description}
                  onClick={() =>
                    setDrafts((current) => ({
                      ...current,
                      [question.id]: togglePendingUserInputOptionSelection(
                        question,
                        current[question.id],
                        value,
                      ),
                    }))
                  }
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          {question.allowCustomAnswer !== false ? (
            <textarea
              aria-label={question.question}
              className="min-h-16 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
              value={drafts[question.id]?.customAnswer ?? ""}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [question.id]: setPendingUserInputCustomAnswer(
                    current[question.id],
                    event.target.value,
                  ),
                }))
              }
            />
          ) : null}
        </fieldset>
      ))}
      <div className="flex gap-2">
        <Button type="submit" size="xs" disabled={disabled || answers === null}>
          {translate("chat.reply.continue")}
        </Button>
        {request.dismissible ? (
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            disabled={disabled}
            onClick={() => void onDismiss()}
          >
            {translate("chat.approval.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
