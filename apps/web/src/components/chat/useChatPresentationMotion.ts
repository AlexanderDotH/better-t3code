import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate } from "motion/mini";
import { spring } from "motion";
import { createChatMessageArrival } from "./chatMessageArrival";
import type { ChatVisualMode } from "@t3tools/contracts";
import type { TimelineEntry } from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  advanceChatPresentationMotion,
  chatPresentationAnimation,
  type ChatPresentationContent,
  type ChatPresentationMotionState,
} from "./chatPresentationMotion";

const useCommitEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const MESSAGE_MOUNT_GRACE_MS = 600;

function startPresentationAnimation(
  element: HTMLElement,
  keyframes: Parameters<typeof animate>[1],
  options: { duration: number; delay?: number },
) {
  // Motion commits its final styles; clearing them releases temporary compositing layers.
  const originalStyles = Object.keys(keyframes).map(
    (name) => [name, element.style.getPropertyValue(name)] as const,
  );
  let restored = false;
  const restoreStyles = () => {
    if (restored) return;
    restored = true;
    for (const [name, value] of originalStyles) {
      if (value) element.style.setProperty(name, value);
      else element.style.removeProperty(name);
    }
  };
  const durationMs = options.duration * 1000;
  const easing = spring({ duration: durationMs, bounce: 0, keyframes: [0, 1] });
  // A spring type rounds native durations to 50ms; sampling its easing keeps our exact budget.
  const animation = animate(element, keyframes, {
    ...options,
    ease: (progress) => easing.next(progress * durationMs).value,
  });
  return {
    cancel: () => {
      animation.cancel();
      restoreStyles();
    },
    finished: animation.then(restoreStyles),
  };
}

function visibleInViewport(element: HTMLElement, viewport: HTMLElement): boolean {
  const bounds = element.getBoundingClientRect();
  const clip = viewport.getBoundingClientRect();
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.bottom > clip.top &&
    bounds.top < clip.bottom &&
    bounds.right > clip.left &&
    bounds.left < clip.right
  );
}

function motionVisible(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function fileMotionId(turnId: string, path: string): string {
  return JSON.stringify(["file", turnId, path]);
}

function collectContents(
  entries: readonly TimelineEntry[],
  rows: readonly MessagesTimelineRow[],
): ChatPresentationContent[] {
  const contents = entries.map((entry): ChatPresentationContent => {
    if (entry.kind === "message") {
      return {
        id: entry.id,
        createdAt: entry.createdAt,
        kind:
          entry.message.role === "user"
            ? "user"
            : entry.message.role === "assistant"
              ? "assistant"
              : "status",
        ready: entry.message.text.length > 0 || (entry.message.attachments?.length ?? 0) > 0,
      };
    }
    return {
      id: entry.id,
      createdAt: entry.createdAt,
      kind: "status",
      ready: entry.kind === "work",
      ...(entry.kind === "work"
        ? { revision: entry.entry.toolLifecycleStatus ?? entry.entry.label }
        : {}),
    };
  });
  for (const row of rows) {
    if (row.kind !== "message" || !row.assistantTurnDiffSummary) continue;
    const summary = row.assistantTurnDiffSummary;
    for (const file of summary.files) {
      contents.push({
        id: fileMotionId(summary.turnId, file.path),
        createdAt: summary.completedAt,
        kind: "result",
        ready: true,
      });
    }
  }
  return contents;
}

function createContentsProjection() {
  let previous: readonly ChatPresentationContent[] = [];
  let sorted: readonly ChatPresentationContent[] = [];
  return (entries: readonly TimelineEntry[], rows: readonly MessagesTimelineRow[]) => {
    const next = collectContents(entries, rows);
    if (
      next.length === previous.length &&
      next.every((content, index) => {
        const prior = previous[index]!;
        return (
          content.id === prior.id &&
          content.createdAt === prior.createdAt &&
          content.ready === prior.ready &&
          content.revision === prior.revision &&
          content.kind === prior.kind
        );
      })
    )
      return sorted;
    previous = next;
    sorted = next.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
    return sorted;
  };
}

function rowContainsContent(row: MessagesTimelineRow, id: string): boolean {
  if (row.id === id) return true;
  if (row.kind === "work" || row.kind === "work-live") {
    return row.groupedEntries.some((entry) => entry.id === id);
  }
  if (row.kind === "activity-group") return row.entries.some((entry) => entry.id === id);
  return false;
}

/** Admission lives above virtualized rows so recycling cannot replay an entry. */
export function useChatPresentationMotion({
  identity,
  mode,
  enabled,
  textMotion,
  connected,
  entries,
  rows,
  viewport,
}: {
  identity: string;
  mode: ChatVisualMode;
  enabled: boolean;
  textMotion: boolean;
  connected: boolean;
  entries: readonly TimelineEntry[];
  rows: readonly MessagesTimelineRow[];
  viewport: HTMLElement | null;
}) {
  const stateRef = useRef<ChatPresentationMotionState | null>(null);
  const [streamBaseline, setStreamBaseline] = useState<{
    identity: string;
    mode: ChatVisualMode;
    connected: boolean;
  } | null>(null);
  const animationsRef = useRef(
    new Map<HTMLElement, ReturnType<typeof startPresentationAnimation>>(),
  );
  const pendingRef = useRef(
    new Map<string, { content: ChatPresentationContent; expiresAt: number }>(),
  );
  const arrivalRef = useRef<ReturnType<typeof createChatMessageArrival> | null>(null);
  const textMotionRef = useRef(textMotion);
  const visibilityResetRef = useRef(false);
  const projectContents = useMemo(() => createContentsProjection(), []);
  const contents = useMemo(
    () => (mode === "better-t3" && (enabled || textMotion) ? projectContents(entries, rows) : []),
    [mode, enabled, textMotion, entries, rows, projectContents],
  );
  const visibilityReset = visibilityResetRef.current;
  const next = useMemo(
    () =>
      advanceChatPresentationMotion(visibilityReset ? null : stateRef.current, {
        identity,
        mode,
        enabled: mode === "better-t3" && (enabled || textMotion),
        visible: motionVisible(),
        connected,
        contents,
      }),
    [identity, mode, enabled, textMotion, connected, contents, visibilityReset],
  );
  const streamingMotionReady =
    streamBaseline?.identity === identity &&
    streamBaseline.mode === mode &&
    streamBaseline.connected &&
    connected;
  const canAnimateInitialText = useCallback(
    (id: string) => {
      if (!textMotion || !next.state.active || !motionVisible()) return false;
      if (
        stateRef.current !== next.state &&
        next.admitted.some((content) => content.id === id && content.kind === "assistant")
      )
        return true;
      const pending = pendingRef.current.get(id);
      return pending?.content.kind === "assistant" && performance.now() < pending.expiresAt;
    },
    [next, textMotion],
  );

  useCommitEffect(() => {
    setStreamBaseline(mode === "better-t3" ? { identity, mode, connected } : null);
  }, [identity, mode, connected]);

  useCommitEffect(() => {
    const previous = stateRef.current;
    const fresh = previous !== next.state;
    visibilityResetRef.current = false;
    stateRef.current = next.state;
    const reset =
      !next.state.active ||
      previous?.identity !== identity ||
      previous?.mode !== mode ||
      textMotionRef.current !== textMotion ||
      visibilityReset;
    if (reset) pendingRef.current.clear();
    if (reset || !enabled) {
      for (const animation of animationsRef.current.values()) animation.cancel();
      animationsRef.current.clear();
      arrivalRef.current?.stop();
    }
    textMotionRef.current = textMotion;
    if (fresh && next.state.active) {
      for (const content of next.admitted) {
        pendingRef.current.set(content.id, {
          content,
          expiresAt: performance.now() + MESSAGE_MOUNT_GRACE_MS,
        });
      }
    }
    if (!viewport || pendingRef.current.size === 0) return;

    const animateElement = (
      element: HTMLElement,
      keyframes: Parameters<typeof startPresentationAnimation>[1],
      options: { duration: number; delay?: number },
    ) => {
      animationsRef.current.get(element)?.cancel();
      const animation = startPresentationAnimation(element, keyframes, options);
      animationsRef.current.set(element, animation);
      void animation.finished.then(() => {
        if (animationsRef.current.get(element) === animation) animationsRef.current.delete(element);
      });
    };
    const playPending = () => {
      const rowElements = new Map(
        [...viewport.querySelectorAll<HTMLElement>("[data-timeline-row-id]")].map((element) => [
          element.dataset.timelineRowId,
          element,
        ]),
      );
      const animatedElements = new Set<HTMLElement>();
      let resultIndex = 0;
      for (const [id, pending] of pendingRef.current) {
        if (performance.now() >= pending.expiresAt || !motionVisible()) {
          pendingRef.current.delete(id);
          continue;
        }
        const content = pending.content;
        const isMessage = content.kind === "assistant" || content.kind === "user";
        let element: HTMLElement | undefined;
        if (content.kind === "result") {
          for (const row of rows) {
            if (row.kind !== "message" || !row.assistantTurnDiffSummary) continue;
            const summary = row.assistantTurnDiffSummary;
            const file = summary.files.find(
              (candidate) => fileMotionId(summary.turnId, candidate.path) === id,
            );
            if (!file) continue;
            element = [
              ...(rowElements
                .get(row.id)
                ?.querySelectorAll<HTMLElement>("[data-presentation-file]") ?? []),
            ].find((candidate) => candidate.dataset.presentationFile === file.path);
            break;
          }
        } else {
          let row = rows.find((candidate) => rowContainsContent(candidate, id));
          if (!row && content.kind === "status") {
            const source = entries.find((entry) => entry.id === id);
            if (source?.kind === "work") {
              row = rows.findLast(
                (candidate) =>
                  candidate.kind === "work-toggle" && candidate.turnId === source.entry.turnId,
              );
            }
          }
          if (row) {
            element = rowElements.get(row.id);
            if (isMessage)
              element =
                element?.querySelector<HTMLElement>("[data-presentation-bubble]") ?? undefined;
            if (content.kind === "status") {
              element =
                element?.querySelector<HTMLElement>("[data-presentation-status]") ?? element;
            }
          }
        }
        // Virtualized rows may mount after their data commit; consume once the DOM is available.
        if (!element) continue;
        pendingRef.current.delete(id);
        if (
          !enabled ||
          animatedElements.has(element) ||
          !visibleInViewport(element, viewport) ||
          typeof element.animate !== "function"
        )
          continue;
        animatedElements.add(element);
        const animation = chatPresentationAnimation(content.kind, resultIndex, textMotion);
        if (content.kind === "result") resultIndex += 1;
        animateElement(element, animation.keyframes, animation.options);
        if (isMessage) {
          const surface = element.querySelector<HTMLElement>("[data-presentation-surface]");
          if (surface) {
            if (content.kind === "assistant" && textMotion) {
              animateElement(surface, { opacity: [0, 1] }, animation.options);
            }
            arrivalRef.current ??= createChatMessageArrival(viewport);
            arrivalRef.current.play(surface);
          }
        }
      }
    };
    playPending();
    if (pendingRef.current.size === 0) return;
    const observer = new MutationObserver(playPending);
    observer.observe(viewport, { childList: true, subtree: true });
    const deadline = Math.max(
      ...[...pendingRef.current.values()].map((pending) => pending.expiresAt),
    );
    const timeout = window.setTimeout(
      () => {
        observer.disconnect();
        pendingRef.current.clear();
      },
      Math.max(0, deadline - performance.now()),
    );
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [next, identity, mode, enabled, textMotion, entries, rows, viewport, visibilityReset]);

  useEffect(() => {
    const animations = animationsRef.current;
    const cancel = () => {
      visibilityResetRef.current = true;
      pendingRef.current.clear();
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      arrivalRef.current?.stop();
    };
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    document.addEventListener("visibilitychange", cancel);
    reducedMotion?.addEventListener?.("change", cancel);
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", cancel);
      reducedMotion?.removeEventListener?.("change", cancel);
    };
  }, []);
  useEffect(
    () => () => {
      arrivalRef.current?.dispose();
      arrivalRef.current = null;
      pendingRef.current.clear();
    },
    [viewport, identity],
  );
  return { streamingMotionReady, canAnimateInitialText };
}

export function useChatDetailMotion(enabled: boolean, expanded: boolean, identity: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const previous = useRef({ expanded, identity, enabled });
  useCommitEffect(() => {
    const prior = previous.current;
    previous.current = { expanded, identity, enabled };
    if (
      !enabled ||
      !prior.enabled ||
      !expanded ||
      prior.expanded ||
      prior.identity !== identity ||
      !motionVisible() ||
      !ref.current?.animate
    )
      return;
    const animation = startPresentationAnimation(
      ref.current,
      { opacity: [0, 1] },
      { duration: 0.16 },
    );
    const cancel = () => animation.cancel();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    document.addEventListener("visibilitychange", cancel);
    reducedMotion?.addEventListener?.("change", cancel);
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", cancel);
      reducedMotion?.removeEventListener?.("change", cancel);
    };
  }, [enabled, expanded, identity]);
  return ref;
}
