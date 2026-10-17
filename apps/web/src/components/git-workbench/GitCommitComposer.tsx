import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useId, useRef } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";

import {
  requestGitActionsControl,
  requestGitCommit,
  type GitCommitOutcome,
} from "../gitActionsControlBus";
import {
  EMPTY_GIT_COMMIT_DRAFT,
  gitCommitDraftKey,
  useGitCommitDraftStore,
} from "./gitCommitDraftStore";

export interface GitCommitComposerProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly stateToken: string;
  readonly stagedCount: number;
  readonly partialStagedCount: number;
  readonly blocked: boolean;
  readonly activeTurn: boolean;
  readonly hasQueuedWorkflow: boolean;
  readonly focusRequest: number;
  readonly pushAvailable: boolean;
  readonly changeRequest?:
    | {
        readonly label: string;
        readonly enabled: boolean;
        readonly openExisting: boolean;
      }
    | undefined;
  readonly nextAction?:
    | {
        readonly label: string;
        readonly disabled: boolean;
        readonly onSelect: () => void;
      }
    | undefined;
  readonly onQueueCommit: (input: { commitMessage?: string }) => Promise<GitCommitOutcome>;
  readonly onSettled?: (() => void) | undefined;
}

export function GitCommitComposer(props: GitCommitComposerProps) {
  const translate = useInterfaceTranslator().message;
  const modeName = useId();
  const messageId = useId();
  const scope = gitCommitDraftKey(props.environmentId, props.cwd);
  const draft = useGitCommitDraftStore(
    (state) => state.drafts.get(scope) ?? EMPTY_GIT_COMMIT_DRAFT,
  );
  const update = useGitCommitDraftStore((state) => state.update);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const automaticRef = useRef<HTMLInputElement | null>(null);
  const lastFocusRequest = useRef(0);
  useEffect(() => {
    if (!props.focusRequest || props.focusRequest === lastFocusRequest.current) return;
    lastFocusRequest.current = props.focusRequest;
    const target = draft.mode === "manual" ? messageRef.current : automaticRef.current;
    target?.focus({ preventScroll: true });
  }, [draft.mode, props.focusRequest]);

  const pending = draft.pending !== null;
  const disabled =
    props.blocked ||
    props.hasQueuedWorkflow ||
    props.stagedCount === 0 ||
    pending ||
    (draft.mode === "manual" && !draft.message.trim());
  const created =
    draft.outcome?.status === "success" && draft.outcome.result.commit.status === "created";

  async function submit(featureBranch = false) {
    if (disabled || (featureBranch && props.activeTurn)) return;
    const store = useGitCommitDraftStore.getState();
    const submission = store.begin(scope);
    if (!submission) return;
    const message = submission.mode === "manual" ? { commitMessage: submission.message } : {};
    let outcome: GitCommitOutcome;
    try {
      outcome = props.activeTurn
        ? await props.onQueueCommit(message)
        : await requestGitCommit({
            environmentId: props.environmentId,
            cwd: props.cwd,
            expectedStateToken: props.stateToken,
            commitSelection: { mode: "staged" },
            ...message,
            ...(featureBranch ? { featureBranch: true } : {}),
          });
    } catch (error) {
      outcome = {
        status: "failure",
        message: error instanceof Error ? error.message : translate("git.common.errorOccurred"),
      };
    }
    store.settle(scope, submission, outcome);
    props.onSettled?.();
  }

  const outcome = draft.outcome;
  const notice = (() => {
    if (!outcome) return null;
    switch (outcome.status) {
      case "failure":
        return outcome.message;
      case "cancelled":
        return translate("git.commit.cancelled");
      case "queued":
        return translate("git.commit.queued");
      case "blocked":
        switch (outcome.reason) {
          case "empty":
            return translate("git.commit.noSelection");
          case "changed":
            return translate("git.changes.stagingStateChanged");
          case "busy":
          case "operation":
            return translate("git.changes.stagingBlocked");
          case "unavailable":
            return translate("git.workbench.unavailable");
        }
        break;
      case "success":
        return translate(
          outcome.result.commit.status === "created"
            ? "git.commit.created"
            : "git.commit.noChanges",
        );
    }
  })();

  return (
    <form
      aria-label={translate("git.commit.title")}
      className="flex shrink-0 flex-col gap-2 border-t bg-background px-3 py-2"
      data-git-commit-composer=""
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs" role="status">
          {props.stagedCount === 0
            ? translate("git.commit.noSelection")
            : translate("git.commit.selection", {
                count: props.stagedCount,
                partial: props.partialStagedCount,
              })}
        </p>
        <fieldset className="flex flex-wrap items-center gap-3 text-xs">
          <legend className="sr-only">{translate("git.commit.messageMode")}</legend>
          <label className="flex items-center gap-1.5">
            <input
              checked={draft.mode === "automatic"}
              data-git-commit-mode="automatic"
              name={modeName}
              onChange={() => update(scope, { mode: "automatic" })}
              ref={automaticRef}
              type="radio"
              value="automatic"
            />
            {translate("git.commit.automatic")}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              checked={draft.mode === "manual"}
              data-git-commit-mode="manual"
              name={modeName}
              onChange={() => update(scope, { mode: "manual" })}
              type="radio"
              value="manual"
            />
            {translate("git.commit.manual")}
          </label>
        </fieldset>
      </div>
      <label className="sr-only" htmlFor={messageId}>
        {translate("git.commit.message")}
      </label>
      <Textarea
        data-git-commit-message=""
        disabled={draft.mode === "automatic"}
        id={messageId}
        onChange={(event) => update(scope, { message: event.target.value })}
        placeholder={translate(
          draft.mode === "automatic"
            ? "git.commit.generatedOnCommit"
            : "git.commit.messagePlaceholder",
        )}
        ref={messageRef}
        rows={2}
        size="sm"
        value={draft.mode === "manual" ? draft.message : ""}
      />
      {notice ? (
        <p
          className="text-xs"
          role={outcome?.status === "failure" || outcome?.status === "blocked" ? "alert" : "status"}
        >
          {notice}
        </p>
      ) : null}
      {props.hasQueuedWorkflow ? (
        <p className="text-muted-foreground text-xs">{translate("git.commit.queueExists")}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {created ? (
          <>
            <Button
              data-git-commit-action="push"
              disabled={props.blocked || props.activeTurn || !props.pushAvailable || pending}
              onClick={() =>
                requestGitActionsControl({
                  environmentId: props.environmentId,
                  cwd: props.cwd,
                  intent: "push",
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {translate("git.overview.action.push")}
            </Button>
            {props.changeRequest ? (
              <Button
                data-git-commit-action="request"
                disabled={
                  props.blocked || props.activeTurn || !props.changeRequest.enabled || pending
                }
                onClick={() =>
                  requestGitActionsControl({
                    environmentId: props.environmentId,
                    cwd: props.cwd,
                    intent: props.changeRequest?.openExisting
                      ? "open-pull-request"
                      : "create-pull-request",
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                {props.changeRequest.label}
              </Button>
            ) : null}
          </>
        ) : props.stagedCount === 0 && props.nextAction ? (
          <Button
            disabled={props.nextAction.disabled}
            onClick={props.nextAction.onSelect}
            size="sm"
            type="button"
            variant="outline"
          >
            {props.nextAction.label}
          </Button>
        ) : null}
        {!props.activeTurn ? (
          <Button
            data-git-commit-action="new-branch"
            disabled={disabled}
            onClick={() => void submit(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            {translate("git.commit.newBranch")}
          </Button>
        ) : null}
        <Button
          data-git-commit-action={props.activeTurn ? "queue" : "commit"}
          disabled={disabled}
          size="sm"
          type="submit"
        >
          {translate(
            pending
              ? "git.commit.pending"
              : props.activeTurn
                ? "git.commit.queue"
                : "git.commit.submit",
          )}
        </Button>
      </div>
    </form>
  );
}
