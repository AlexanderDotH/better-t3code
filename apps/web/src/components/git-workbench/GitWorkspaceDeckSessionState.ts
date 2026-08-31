import type { EnvironmentId } from "@t3tools/contracts";

import type { ChatWorkspaceCardId } from "./ChatWorkspaceDeck";

export interface BufferedFileEdit {
  readonly baseContent: string;
  readonly baseRevision: string;
  readonly content: string;
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly path: string;
  readonly conflict?: boolean;
  readonly createUndoBeforeWrite?: boolean;
  readonly error?: string;
}

export const bufferedFileEdits = new Map<string, BufferedFileEdit>();
export const deckSelectionByThread = new Map<string, ChatWorkspaceCardId>();

const DECK_SELECTION_LIMIT = 200;

export interface ScopedWorkspaceDeckSelection {
  readonly card: ChatWorkspaceCardId;
  readonly scopeKey: string;
}

export function rememberDeckSelection(scopeKey: string, card: ChatWorkspaceCardId): void {
  deckSelectionByThread.delete(scopeKey);
  deckSelectionByThread.set(scopeKey, card);
  while (deckSelectionByThread.size > DECK_SELECTION_LIMIT) {
    const oldest = deckSelectionByThread.keys().next().value;
    if (oldest === undefined) break;
    deckSelectionByThread.delete(oldest);
  }
}

export function workspaceFileBufferKey(
  environmentId: EnvironmentId,
  cwd: string,
  path: string,
): string {
  return JSON.stringify([environmentId, cwd, path]);
}
