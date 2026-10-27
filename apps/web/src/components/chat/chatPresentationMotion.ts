export type ChatPresentationMotionKind = "user" | "assistant" | "result" | "status";

export interface ChatPresentationContent {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: ChatPresentationMotionKind;
  readonly ready: boolean;
  readonly revision?: string;
}

export interface ChatPresentationMotionInput {
  readonly identity: string;
  readonly mode: string;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly connected: boolean;
  readonly contents: readonly ChatPresentationContent[];
}

export interface ChatPresentationMotionState {
  readonly contents: readonly ChatPresentationContent[];
  readonly identity: string;
  readonly mode: string;
  readonly active: boolean;
  readonly tailId: string | null;
  readonly newestCreatedAt: string;
  readonly seen: ReadonlyMap<string, ChatPresentationContent>;
  readonly pending: ReadonlySet<string>;
}

/** Only live appends get admission; mounting or revealing stored content never does. */
export function advanceChatPresentationMotion(
  previous: ChatPresentationMotionState | null,
  input: ChatPresentationMotionInput,
): { state: ChatPresentationMotionState; admitted: readonly ChatPresentationContent[] } {
  const active = input.enabled && input.visible && input.connected;
  if (
    previous?.contents === input.contents &&
    previous.identity === input.identity &&
    previous.mode === input.mode &&
    previous.active === active
  )
    return { state: previous, admitted: [] };
  const previousTailIndex = previous?.tailId
    ? input.contents.findIndex((content) => content.id === previous.tailId)
    : -1;
  const baseline =
    previous === null ||
    previous.identity !== input.identity ||
    previous.mode !== input.mode ||
    !active ||
    !previous.active ||
    (previous.tailId !== null && previousTailIndex === -1);
  const seen = new Map(baseline ? [] : previous.seen);
  const pending = new Set(baseline ? [] : previous.pending);
  const admitted: ChatPresentationContent[] = [];
  let newestCreatedAt = baseline ? "" : previous.newestCreatedAt;

  input.contents.forEach((content, index) => {
    const prior = seen.get(content.id);
    const appended =
      !baseline &&
      prior === undefined &&
      index > previousTailIndex &&
      content.createdAt >= previous.newestCreatedAt;
    if (appended && !content.ready) pending.add(content.id);
    const firstContent = content.ready && (appended || pending.has(content.id));
    const statusChanged =
      !baseline &&
      content.kind === "status" &&
      prior !== undefined &&
      content.revision !== prior.revision;
    if (firstContent || statusChanged) {
      admitted.push(content);
      pending.delete(content.id);
    }
    seen.set(content.id, content);
    if (content.createdAt > newestCreatedAt) newestCreatedAt = content.createdAt;
  });

  return {
    state: {
      contents: input.contents,
      identity: input.identity,
      mode: input.mode,
      active,
      tailId: input.contents.at(-1)?.id ?? null,
      newestCreatedAt,
      seen,
      pending,
    },
    admitted,
  };
}

const RESULT_STAGGER_MS = 40;
const RESULT_DURATION_MS = 160;
const RESULT_SEQUENCE_LIMIT_MS = 360;

export function chatPresentationAnimation(
  kind: ChatPresentationMotionKind,
  index: number,
  textMotion: boolean,
) {
  const duration = kind === "user" ? 320 : kind === "assistant" ? 360 : RESULT_DURATION_MS;
  const offset = kind === "user" ? 12 : kind === "assistant" ? 10 : 0;
  return {
    keyframes: {
      ...(kind === "assistant" && textMotion ? {} : { opacity: [0, 1] }),
      ...(offset > 0 ? { transform: [`translateY(${offset}px)`, "translateY(0)"] } : {}),
    },
    options: {
      duration: duration / 1000,
      delay:
        kind === "result"
          ? Math.min(index * RESULT_STAGGER_MS, RESULT_SEQUENCE_LIMIT_MS - duration) / 1000
          : 0,
    },
  };
}
