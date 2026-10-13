import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  drafts: {} as Record<string, unknown>,
  uploads: {} as Record<string, unknown>,
  preparations: {} as Record<string, number>,
  preparationAtom: Symbol("preparation"),
  replyActivities: [] as unknown[],
  commands: vi.fn(async (..._args: unknown[]) => ({ _tag: "Success" })),
}));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "drafts"
      ? fixture.drafts
      : atom === "uploads"
        ? fixture.uploads
        : atom === fixture.preparationAtom
          ? fixture.preparations
          : {},
}));
vi.mock("./use-composer-drafts", () => ({
  composerDraftsAtom: "drafts",
  clearComposerDraft: vi.fn(),
}));
vi.mock("./composer-attachment-uploads", async () => ({
  ...(await import("../lib/composerAttachmentUploadQueue")),
  composerAttachmentUploadsAtom: "uploads",
}));
vi.mock("./question-attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./question-attachments")>()),
  questionAttachmentPreparationAtom: fixture.preparationAtom,
}));
vi.mock("./entities", () => ({
  useServerConfigs: () =>
    new Map([
      [
        "environment-1",
        {
          environment: {
            capabilities: {
              questionAttachments: true,
              attachmentUploads: true,
              fileAttachments: { maxUploadBytes: 20_000_000 },
            },
          },
        },
      ],
    ]),
}));
vi.mock("./threads", () => ({
  threadEnvironment: {
    respondToReplyApproval: "reply-approval",
    respondToReplyUserInput: "reply-input",
    dismissReplyUserInput: "reply-dismiss",
  },
}));
vi.mock("./use-atom-command", () => ({
  useAtomCommand: (command: unknown) => (input: unknown) => fixture.commands(command, input),
}));
vi.mock("./use-thread-selection", () => ({
  useThreadSelection: () => ({
    selectedThread: { environmentId: "environment-1", id: "thread-1" },
  }),
}));
vi.mock("./use-thread-detail", () => ({
  useSelectedThreadDetail: () => ({
    replyActivities: fixture.replyActivities,
    activities: [
      {
        id: "request-activity",
        kind: "user-input.requested",
        createdAt: "2026-09-08T00:00:00Z",
        payload: {
          requestId: "request-1",
          questions: ["first", "second"].map((id) => ({
            id,
            header: id,
            question: `Attach ${id} file`,
            options: [],
            allowCustomAnswer: true,
          })),
        },
      },
    ],
  }),
}));

import { ApprovalRequestId, EnvironmentId, ThreadId, SubagentId } from "@t3tools/contracts";
import { questionAttachmentDraftKey } from "./question-attachments";
import { useSelectedThreadRequests } from "./use-selected-thread-requests";
import { composerDraftEnvironmentId } from "../lib/composerAttachmentUploadQueue";

const environmentId = EnvironmentId.make("environment-1");
const key = (question: string) =>
  questionAttachmentDraftKey(
    environmentId,
    ThreadId.make("thread-1"),
    ApprovalRequestId.make("request-1"),
    question,
  );
function submitButtonMarkup() {
  function Probe() {
    const { activePendingUserInputAnswers } = useSelectedThreadRequests();
    return <button disabled={activePendingUserInputAnswers === null}>Submit answers</button>;
  }
  return renderToStaticMarkup(<Probe />);
}
beforeEach(() => {
  fixture.replyActivities = [];
  fixture.commands.mockClear();
  fixture.preparations = {};
  fixture.drafts = Object.fromEntries(
    ["first", "second"].map((id) => [
      key(id),
      {
        attachments: [
          {
            id,
            type: "file",
            name: `${id}.txt`,
            mimeType: "text/plain",
            sizeBytes: 4,
            fileUri: `file:///${id}.txt`,
          },
        ],
      },
    ]),
  );
  fixture.uploads = { "environment-1:first": { status: "ready" } };
});

describe("reply request routing", () => {
  it("keeps duplicate request ids separate and sends approval decisions to their topic", async () => {
    const firstTopic = SubagentId.make("first-topic");
    const secondTopic = SubagentId.make("second-topic");
    fixture.replyActivities = [firstTopic, secondTopic].map((replyTopicId) => ({
      id: `${replyTopicId}-request`,
      kind: "approval.requested",
      replyTopicId,
      createdAt: "2026-10-13T10:00:00Z",
      payload: { requestId: "same-request", requestKind: "command", detail: replyTopicId },
    }));
    fixture.replyActivities.push({
      id: "first-response",
      kind: "approval.resolved",
      replyTopicId: firstTopic,
      createdAt: "2026-10-13T10:00:01Z",
      payload: { requestId: "same-request", decision: "accept" },
    });
    const captured: Array<ReturnType<typeof useSelectedThreadRequests>> = [];
    function Probe() {
      captured.push(useSelectedThreadRequests(firstTopic), useSelectedThreadRequests(secondTopic));
      return null;
    }
    renderToStaticMarkup(<Probe />);
    expect(captured[0]?.activePendingApproval).toBeNull();
    expect(captured[1]?.activePendingApproval?.detail).toBe(secondTopic);
    await captured[1]!.onRespondToApproval(ApprovalRequestId.make("same-request"), "decline");
    expect(fixture.commands).toHaveBeenCalledWith("reply-approval", {
      environmentId,
      input: {
        threadId: "thread-1",
        replyTopicId: secondTopic,
        requestId: "same-request",
        decision: "decline",
      },
    });
  });
  it("scopes question attachment drafts by environment, thread and topic", () => {
    const args = [
      environmentId,
      ThreadId.make("thread-1"),
      ApprovalRequestId.make("same-request"),
      "question",
    ] as const;
    const keys = [
      questionAttachmentDraftKey(...args),
      questionAttachmentDraftKey(...args, SubagentId.make("first-topic")),
      questionAttachmentDraftKey(...args, SubagentId.make("second-topic")),
      questionAttachmentDraftKey(
        EnvironmentId.make("other-environment"),
        args[1],
        args[2],
        args[3],
        SubagentId.make("first-topic"),
      ),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.map((draftKey) => composerDraftEnvironmentId(draftKey, []))).toEqual([
      environmentId,
      environmentId,
      environmentId,
      "other-environment",
    ]);
  });
});
describe("question attachment submission readiness", () => {
  it.each([
    undefined,
    { status: "uploading", progress: 0.5 },
    { status: "failed", reason: "Offline" },
  ])("keeps Submit disabled until all question uploads finish: %j", (state) => {
    if (state) fixture.uploads["environment-1:second"] = state;
    expect(submitButtonMarkup()).toContain("disabled");
    fixture.uploads["environment-1:second"] = { status: "ready" };
    expect(submitButtonMarkup()).not.toContain("disabled");
  });
  it("ignores an upload in another environment", () => {
    fixture.uploads["environment-1:second"] = { status: "ready" };
    fixture.uploads["environment-2:second"] = { status: "uploading", progress: 0.5 };
    expect(submitButtonMarkup()).not.toContain("disabled");
  });
  it("waits for attachment preparation even when uploads are ready", () => {
    fixture.uploads["environment-1:second"] = { status: "ready" };
    fixture.preparations[key("first")] = 1;
    expect(submitButtonMarkup()).toContain("disabled");
  });
});
