import { describe, expect, it } from "vite-plus/test";
import {
  createMessageReplyReference,
  getMessageReplyPreview,
} from "@t3tools/client-runtime/messageReplies";
import { makeBetterT3SettingsV1, MessageId, SubagentId } from "@t3tools/contracts";
import type { ComposerDraft } from "../../state/use-composer-drafts";
import {
  mobileMessageRepliesEnabled,
  mobileReplyTopicActionsEnabled,
} from "../../lib/message-replies";
import { messageReplyDraftCompletion } from "../../state/message-reply-draft";

const source = {
  id: MessageId.make("same-id"),
  role: "assistant" as const,
  text: "A **brief** explanation\nwith [a reference](https://example.com).",
  createdAt: "2026-10-13T10:00:00.000Z",
  updatedAt: "2026-10-13T10:00:00.000Z",
  streaming: false,
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
