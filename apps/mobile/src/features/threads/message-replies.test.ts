import { describe, expect, it } from "vite-plus/test";
import {
  createMessageReplyReference,
  getMessageReplyPreview,
  mergeMessageReplyTimeline,
} from "@t3tools/client-runtime/messageReplies";
import {
  makeBetterT3SettingsV1,
  MessageId,
  SubagentId,
  TurnId,
  type OrchestrationMessage,
} from "@t3tools/contracts";
import { buildThreadFeed, deriveThreadFeedPresentation } from "../../lib/threadActivity";
import type { ComposerDraft } from "../../state/use-composer-drafts";
import {
  messageReplyDraftCompletion,
  mobileMessageRepliesEnabled,
  mobileReplyTopicActionsEnabled,
  mobileReplyMessageKey,
} from "./message-replies";

const source: OrchestrationMessage = {
  id: MessageId.make("same-id"),
  role: "assistant",
  text: "A **brief** explanation\nwith [a reference](https://example.com).",
  createdAt: "2026-10-13T10:00:00.000Z",
  updatedAt: "2026-10-13T10:00:00.000Z",
  streaming: false,
  turnId: null,
};
const reply = {
  replyTo: createMessageReplyReference(source)!,
  replyTopicId: SubagentId.make("topic"),
};
const draft: ComposerDraft = { text: "Follow up", attachments: [], messageReply: reply };

describe("mobile message reply presentation", () => {
  it("requires the current environment capability and honors the device switch", () => {
    const enabled = makeBetterT3SettingsV1("clean-install");
    const disabled = makeBetterT3SettingsV1("clean-install", { "chat.messageReplies": false });
    expect(mobileMessageRepliesEnabled({ messageReplies: true }, enabled)).toBe(true);
    expect(mobileMessageRepliesEnabled({ messageReplies: true }, disabled)).toBe(false);
    expect(mobileReplyTopicActionsEnabled({ messageReplies: true }, true)).toBe(true);
    expect(mobileReplyTopicActionsEnabled({ messageReplies: true }, false)).toBe(false);
    expect(mobileReplyTopicActionsEnabled({}, true)).toBe(false);
    expect(mobileMessageRepliesEnabled({}, enabled)).toBe(false);
    expect(mobileMessageRepliesEnabled(undefined, enabled)).toBe(false);
  });
  it("uses one plain excerpt and names attachment-only sources", () => {
    expect(getMessageReplyPreview(reply.replyTo)).toBe("A brief explanation with a reference.");
    const reference = createMessageReplyReference({
      ...source,
      text: "",
      attachments: [{ name: "design.png" }, { name: "notes.txt" }],
    });
    expect(getMessageReplyPreview(reference!)).toBe("design.png, notes.txt");
  });
  it.each(["current", "classic"] as const)(
    "keeps replies inline and distinct in %s appearance",
    (appearance) => {
      const followup: OrchestrationMessage = {
        ...source,
        replyTopicId: reply.replyTopicId,
        replyTo: reply.replyTo,
        text: "Follow up",
        role: "user",
        createdAt: "2026-10-13T10:00:01.000Z",
        updatedAt: "2026-10-13T10:00:01.000Z",
      };
      const feed = buildThreadFeed({
        messages: mergeMessageReplyTimeline([source], [followup]),
        activities: [],
      });
      const presented = deriveThreadFeedPresentation(
        feed,
        null,
        new Set(),
        new Set(),
        null,
        appearance,
      );
      const messages = presented.filter((entry) => entry.type === "message");
      expect(messages.map((entry) => entry.id)).toEqual([
        source.id,
        mobileReplyMessageKey(followup),
      ]);
      expect(messages[1]?.message.replyTo).toEqual(reply.replyTo);
    },
  );
  it.each(["current", "classic"] as const)(
    "keeps root folds independent of a reply provider reusing its turn id in %s appearance",
    (appearance) => {
      const turnId = TurnId.make("provider-turn");
      const rootMessages = [0, 1, 2].map((index) => ({
        ...source,
        id: MessageId.make(`root-${index}`),
        turnId,
        createdAt: `2026-10-13T10:00:0${index}.000Z`,
        updatedAt: `2026-10-13T10:00:0${index}.000Z`,
      }));
      const topicAnswer = {
        ...source,
        id: MessageId.make("topic-answer"),
        replyTopicId: reply.replyTopicId,
        turnId,
        createdAt: "2026-10-13T10:00:03.000Z",
        updatedAt: "2026-10-13T10:00:03.000Z",
      };
      const rootFeed = buildThreadFeed({ messages: rootMessages, activities: [] });
      const mergedFeed = buildThreadFeed({
        messages: [...rootMessages, topicAnswer],
        activities: [],
      });
      const present = (feed: typeof rootFeed) =>
        deriveThreadFeedPresentation(feed, null, new Set(), new Set(), null, appearance);
      const visible = present(mergedFeed);
      expect(
        visible.filter(
          (entry) => entry.type !== "message" || entry.message.replyTopicId === undefined,
        ),
      ).toEqual(present(rootFeed));
      expect(
        visible.some((entry) => entry.type === "message" && entry.message.id === topicAnswer.id),
      ).toBe(true);
    },
  );
  it("clears accepted content, retains newer typing, and does not replace a newly chosen source", () => {
    expect(messageReplyDraftCompletion(draft, draft)).toBe("clear");
    expect(messageReplyDraftCompletion({ ...draft, text: "New typing" }, draft)).toBe(
      "cancel-reply",
    );
    expect(
      messageReplyDraftCompletion(
        { ...draft, messageReply: { ...reply, replyTopicId: SubagentId.make("other-topic") } },
        draft,
      ),
    ).toBe("retain");
    expect(messageReplyDraftCompletion({ ...draft, messageReply: undefined }, draft)).toBe(
      "retain",
    );
  });
});
