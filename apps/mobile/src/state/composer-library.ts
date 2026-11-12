import type { ComposerDraft } from "./use-composer-drafts";
import {
  clearComposerDraftContentState,
  composerDraftsAtom,
  schedulePersistComposerState,
  scheduleUnusedComposerAttachmentCleanup,
} from "./use-composer-drafts";
import { appAtomRegistry } from "./atom-registry";
import { uuidv4 } from "../lib/uuid";

type Drafts = Readonly<Record<string, ComposerDraft>>;

function hasContent(draft: ComposerDraft | undefined) {
  return draft !== undefined && (draft.text.trim().length > 0 || draft.attachments.length > 0);
}

function stashPrefix(draftKey: string, draft?: ComposerDraft, environmentId?: string) {
  const separator = draftKey.lastIndexOf(":");
  const owner = environmentId ?? draft?.project?.environmentId ?? draftKey.slice(0, separator);
  return `${owner}:composer-stash~`;
}

export function listComposerStashes(drafts: Drafts, draftKey: string, environmentId?: string) {
  const prefix = stashPrefix(draftKey, drafts[draftKey], environmentId);
  return Object.entries(drafts)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, draft]) => ({
      key,
      draft,
      createdAt: Number(key.slice(prefix.length).split("~")[0]),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function stashComposerDraftState(
  drafts: Drafts,
  draftKey: string,
  id: string,
  createdAt: number,
  environmentId?: string,
): Record<string, ComposerDraft> | null {
  const draft = drafts[draftKey];
  if (!draft || !hasContent(draft)) return null;
  const key = `${stashPrefix(draftKey, draft, environmentId)}${createdAt}~${id}`;
  const cleared = clearComposerDraftContentState({ ...drafts }, draftKey);
  return {
    ...cleared,
    ...(draft?.project
      ? { [draftKey]: { ...cleared[draftKey], text: "", attachments: [], project: draft.project } }
      : {}),
    [key]: draft,
  };
}

export function restoreComposerStashState(
  drafts: Drafts,
  draftKey: string,
  stashKey: string,
  environmentId?: string,
) {
  const saved = drafts[stashKey];
  if (!saved || !stashKey.startsWith(stashPrefix(draftKey, drafts[draftKey], environmentId)))
    return null;
  const next = {
    ...drafts,
    [draftKey]: {
      ...saved,
      project: drafts[draftKey]?.project,
      workspaceSelection: drafts[draftKey]?.workspaceSelection,
    },
  };
  if (hasContent(drafts[draftKey])) next[stashKey] = drafts[draftKey]!;
  else delete next[stashKey];
  return next;
}

export function stashComposerDraft(draftKey: string, environmentId?: string) {
  const next = stashComposerDraftState(
    appAtomRegistry.get(composerDraftsAtom),
    draftKey,
    uuidv4(),
    Date.now(),
    environmentId,
  );
  if (!next) return;
  appAtomRegistry.set(composerDraftsAtom, next);
  schedulePersistComposerState();
}

export function restoreComposerStash(draftKey: string, stashKey: string, environmentId?: string) {
  const next = restoreComposerStashState(
    appAtomRegistry.get(composerDraftsAtom),
    draftKey,
    stashKey,
    environmentId,
  );
  if (!next) return;
  appAtomRegistry.set(composerDraftsAtom, next);
  schedulePersistComposerState();
}

export function deleteComposerStash(draftKey: string, stashKey: string, environmentId?: string) {
  const current = appAtomRegistry.get(composerDraftsAtom);
  if (
    !stashKey.startsWith(stashPrefix(draftKey, current[draftKey], environmentId)) ||
    !current[stashKey]
  )
    return;
  const next = { ...current };
  delete next[stashKey];
  appAtomRegistry.set(composerDraftsAtom, next);
  schedulePersistComposerState();
  scheduleUnusedComposerAttachmentCleanup(current[stashKey].attachments);
}

export function composerPromptHistory(
  messages: ReadonlyArray<{ readonly role: string; readonly text: string }>,
) {
  const seen = new Set<string>();
  return [...messages].reverse().flatMap((message) => {
    const text = message.text.trim();
    if (
      message.role !== "user" ||
      !text ||
      /^\/(?:compact|usage-limits)\s*$/i.test(text) ||
      seen.has(text)
    )
      return [];
    seen.add(text);
    return [text];
  });
}
