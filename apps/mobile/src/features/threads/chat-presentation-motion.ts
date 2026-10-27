export type ChatMotionKind = "user" | "response" | "surface" | "result" | "status";

export interface ChatMotionItem {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: ChatMotionKind;
  readonly revision: string;
  readonly presented?: boolean;
}

export interface ChatMotionAdmission {
  readonly kind: ChatMotionKind;
  readonly delay: number;
  readonly expiresAt: number;
}

const FRESH_ENTRY_MS = 2_000;
const ADMISSION_WINDOW_MS = 600;
const RESULT_STAGGER_MS = 40;
const RESULT_DURATION_MS = 160;
const MAX_RESULT_STAGGER_MS = 360 - RESULT_DURATION_MS;

/** Owned by the feed, so virtualization never grants an entrance twice. */
export function createChatMotionAdmission() {
  const observed = new Map<string, string>();
  const admissions = new Map<string, ChatMotionAdmission>();
  let previousContext: string | null = null;
  let previousEnabled = false;
  let newestTimestamp = Number.NEGATIVE_INFINITY;
  let previousSnapshot: object | undefined;

  return {
    observe(input: {
      readonly context: string;
      readonly enabled: boolean;
      readonly items: readonly ChatMotionItem[];
      readonly now: number;
      readonly characterStreamingMotion: boolean;
      readonly snapshot?: object;
    }) {
      if (input.snapshot !== undefined && previousSnapshot === input.snapshot) return;
      previousSnapshot = input.snapshot;
      const reset = previousContext !== input.context || previousEnabled !== input.enabled;
      if (reset) admissions.clear();
      if (previousContext !== input.context) {
        observed.clear();
        newestTimestamp = Number.NEGATIVE_INFINITY;
      }
      let resultIndex = 0;
      const previousNewest = newestTimestamp;
      for (const item of input.items) {
        const previousRevision = observed.get(item.id);
        const timestamp = Date.parse(item.createdAt);
        const age = input.now - timestamp;
        const isNew = previousRevision === undefined;
        const changed = !isNew && previousRevision !== item.revision;
        const fresh = Number.isFinite(age) && age >= 0 && age <= FRESH_ENTRY_MS;
        const textMotionAllowed = item.kind !== "response" || input.characterStreamingMotion;
        if (
          !reset &&
          input.enabled &&
          item.presented !== false &&
          textMotionAllowed &&
          ((isNew && fresh && timestamp >= previousNewest) || (changed && item.kind === "status"))
        ) {
          admissions.set(item.id, {
            kind: item.kind,
            delay:
              item.kind === "result"
                ? Math.min(resultIndex++ * RESULT_STAGGER_MS, MAX_RESULT_STAGGER_MS)
                : 0,
            expiresAt: input.now + ADMISSION_WINDOW_MS,
          });
        }
        observed.set(item.id, item.revision);
        if (Number.isFinite(timestamp)) newestTimestamp = Math.max(newestTimestamp, timestamp);
      }
      for (const [id, admission] of admissions) {
        if (
          admission.expiresAt < input.now ||
          (admission.kind === "response" && !input.characterStreamingMotion)
        )
          admissions.delete(id);
      }
      previousContext = input.context;
      previousEnabled = input.enabled;
    },
    claim(id: string, now: number): ChatMotionAdmission | null {
      const admission = admissions.get(id);
      admissions.delete(id);
      return admission && admission.expiresAt >= now ? admission : null;
    },
    disclose(id: string, now: number) {
      if (!previousEnabled) return;
      admissions.set(id, { kind: "status", delay: 0, expiresAt: now + ADMISSION_WINDOW_MS });
    },
    discardPending() {
      admissions.clear();
    },
  };
}

export function chatMotionTiming(kind: ChatMotionKind) {
  return {
    duration:
      kind === "user"
        ? 320
        : kind === "result"
          ? RESULT_DURATION_MS
          : kind === "status"
            ? 160
            : kind === "response"
              ? 360
              : 240,
    translateY: kind === "user" ? 12 : kind === "response" ? 10 : 0,
  };
}
