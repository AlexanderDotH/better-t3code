import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, MessageId, SubagentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { partializeComposerDraftStoreState, useComposerDraftStore } from "./composerDraftStore";

const thread = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("same-thread"));
const otherEnvironment = scopeThreadRef(EnvironmentId.make("remote"), thread.threadId);
const first = {
  replyTo: {
    messageId: MessageId.make("source"),
    role: "assistant" as const,
    text: "A full source message",
  },
  replyTopicId: SubagentId.make("topic-1"),
};

beforeEach(() =>
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  }),
);

describe("reply composer draft", () => {
  it("replaces and closes only the reply target while keeping authored input", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(thread, "Already writing a question");
    store.setReplyTarget(thread, first);
    store.setReplyTarget(thread, {
      ...first,
      replyTopicId: SubagentId.make("topic-2"),
      replyTo: { ...first.replyTo, text: "Another source" },
    });
    expect(store.getComposerDraft(thread)?.prompt).toBe("Already writing a question");
    expect(store.getComposerDraft(thread)?.replyTarget?.replyTo.text).toBe("Another source");
    store.setReplyTarget(thread, null);
    expect(store.getComposerDraft(thread)?.replyTarget).toBeUndefined();
    expect(store.getComposerDraft(thread)?.prompt).toBe("Already writing a question");
  });

  it("keeps full snapshots and source topic identity across hydration and environments", () => {
    const store = useComposerDraftStore.getState();
    const fullText = "Untruncated source content. ".repeat(500);
    const reference = {
      ...first,
      replyTo: { ...first.replyTo, replyTopicId: SubagentId.make("topic-source"), text: fullText },
    };
    store.setReplyTarget(thread, reference);
    store.setPrompt(otherEnvironment, "Remote draft");
    const merge = useComposerDraftStore.persist.getOptions().merge!;
    const reloaded = merge(
      JSON.parse(
        JSON.stringify(partializeComposerDraftStoreState(useComposerDraftStore.getState())),
      ),
      useComposerDraftStore.getInitialState(),
    );
    expect(reloaded.draftsByThreadKey[scopedThreadKey(thread)]?.replyTarget).toEqual(reference);
    expect(
      reloaded.draftsByThreadKey[scopedThreadKey(otherEnvironment)]?.replyTarget,
    ).toBeUndefined();
    expect(reloaded.draftsByThreadKey[scopedThreadKey(otherEnvironment)]?.prompt).toBe(
      "Remote draft",
    );
  });

  it("clears the target with a successful submitted draft", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(thread, "Question");
    store.setReplyTarget(thread, first);
    store.clearComposerContent(thread);
    expect(store.getComposerDraft(thread)).toBeNull();
  });
});
