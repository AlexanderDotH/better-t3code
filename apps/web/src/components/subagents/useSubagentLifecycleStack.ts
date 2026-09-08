import type { OrchestrationSubagentSummary, SubagentId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { partitionSubagentsByLifecycle, type SubagentLifecycleEntry } from "./subagentLifecycle";

export const SUBAGENT_ENTER_MS = 420;
export const SUBAGENT_EXIT_MS = 300;
export const SUBAGENT_SLOT_COLLAPSE_MS = 180;

const MAX_TIMEOUT_MS = 2_147_483_647;

export type SubagentPresencePhase =
  | "present"
  | "entering"
  | "exit-ready"
  | "exiting"
  | "collapsing";

export interface SubagentPresenceEntry extends SubagentLifecycleEntry {
  readonly phase: SubagentPresencePhase;
  readonly phaseStartedAtMs: number;
}

export interface SubagentLifecycleStack {
  readonly visible: ReadonlyArray<SubagentPresenceEntry>;
  readonly archived: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly completePhase: (subagentId: SubagentId, phase: SubagentPresencePhase) => void;
}

function sortableStartedAt(entry: SubagentPresenceEntry): number {
  const timestampMs = Date.parse(entry.agent.startedAt);
  return Number.isFinite(timestampMs) ? timestampMs : Number.NEGATIVE_INFINITY;
}

function comparePresence(left: SubagentPresenceEntry, right: SubagentPresenceEntry): number {
  return (
    sortableStartedAt(right) - sortableStartedAt(left) ||
    String(left.agent.id).localeCompare(String(right.agent.id))
  );
}

export function initializeSubagentPresence(
  desired: ReadonlyArray<SubagentLifecycleEntry>,
  nowMs: number,
): ReadonlyArray<SubagentPresenceEntry> {
  return desired.map((entry) => ({
    ...entry,
    phase: "present",
    phaseStartedAtMs: nowMs,
  }));
}

function enteringPresence(entry: SubagentLifecycleEntry, nowMs: number): SubagentPresenceEntry {
  return {
    ...entry,
    phase: "entering",
    phaseStartedAtMs: nowMs,
  };
}

export function reconcileSubagentPresence(
  current: ReadonlyArray<SubagentPresenceEntry>,
  desired: ReadonlyArray<SubagentLifecycleEntry>,
  nowMs: number,
): ReadonlyArray<SubagentPresenceEntry> {
  const currentById = new Map(current.map((entry) => [entry.agent.id, entry]));
  const desiredIds = new Set(desired.map((entry) => entry.agent.id));
  const reconciled: SubagentPresenceEntry[] = desired.map((entry) => {
    const existing = currentById.get(entry.agent.id);
    if (existing === undefined) {
      return enteringPresence(entry, nowMs);
    }
    if (
      existing.phase === "exit-ready" ||
      existing.phase === "exiting" ||
      existing.phase === "collapsing"
    ) {
      return enteringPresence(entry, nowMs);
    }
    return {
      ...entry,
      phase: existing.phase,
      phaseStartedAtMs: existing.phaseStartedAtMs,
    };
  });

  for (const entry of current) {
    if (desiredIds.has(entry.agent.id)) {
      continue;
    }
    if (entry.phase === "exit-ready" || entry.phase === "exiting" || entry.phase === "collapsing") {
      reconciled.push(entry);
      continue;
    }
    reconciled.push({
      ...entry,
      stage: "stale",
      transitionAtMs: null,
      phase: "exit-ready",
      phaseStartedAtMs: nowMs,
    });
  }

  return reconciled.toSorted(comparePresence);
}

export function beginReadySubagentExits(
  current: ReadonlyArray<SubagentPresenceEntry>,
  nowMs: number,
): ReadonlyArray<SubagentPresenceEntry> {
  return current.map((entry) =>
    entry.phase === "exit-ready" ? { ...entry, phase: "exiting", phaseStartedAtMs: nowMs } : entry,
  );
}

function advanceEntry(entry: SubagentPresenceEntry, nowMs: number): SubagentPresenceEntry | null {
  if (entry.phase === "present" || entry.phase === "exit-ready") {
    return entry;
  }
  if (entry.phase === "entering") {
    if (nowMs < entry.phaseStartedAtMs + SUBAGENT_ENTER_MS) {
      return entry;
    }
    return { ...entry, phase: "present", phaseStartedAtMs: nowMs };
  }
  if (entry.phase === "exiting") {
    const collapsingAtMs = entry.phaseStartedAtMs + SUBAGENT_EXIT_MS;
    if (nowMs < collapsingAtMs) {
      return entry;
    }
    if (nowMs >= collapsingAtMs + SUBAGENT_SLOT_COLLAPSE_MS) {
      return null;
    }
    return {
      ...entry,
      phase: "collapsing",
      phaseStartedAtMs: collapsingAtMs,
    };
  }
  if (nowMs >= entry.phaseStartedAtMs + SUBAGENT_SLOT_COLLAPSE_MS) {
    return null;
  }
  return entry;
}

export function advanceSubagentPresence(
  current: ReadonlyArray<SubagentPresenceEntry>,
  nowMs: number,
): ReadonlyArray<SubagentPresenceEntry> {
  return current.flatMap((entry) => {
    const advanced = advanceEntry(entry, nowMs);
    return advanced === null ? [] : [advanced];
  });
}

function nextPresenceTransitionAtMs(presence: ReadonlyArray<SubagentPresenceEntry>): number | null {
  let nextTransitionAtMs: number | null = null;
  for (const entry of presence) {
    const transitionAtMs =
      entry.phase === "entering"
        ? entry.phaseStartedAtMs + SUBAGENT_ENTER_MS
        : entry.phase === "exiting"
          ? entry.phaseStartedAtMs + SUBAGENT_EXIT_MS
          : entry.phase === "collapsing"
            ? entry.phaseStartedAtMs + SUBAGENT_SLOT_COLLAPSE_MS
            : null;
    if (
      transitionAtMs !== null &&
      (nextTransitionAtMs === null || transitionAtMs < nextTransitionAtMs)
    ) {
      nextTransitionAtMs = transitionAtMs;
    }
  }
  return nextTransitionAtMs;
}

function completePresencePhase(
  current: ReadonlyArray<SubagentPresenceEntry>,
  subagentId: SubagentId,
  phase: SubagentPresencePhase,
  nowMs: number,
): ReadonlyArray<SubagentPresenceEntry> {
  return current.flatMap((entry) => {
    if (entry.agent.id !== subagentId || entry.phase !== phase) {
      return [entry];
    }
    if (phase === "entering") {
      return [{ ...entry, phase: "present", phaseStartedAtMs: nowMs }];
    }
    if (phase === "exiting") {
      return [{ ...entry, phase: "collapsing", phaseStartedAtMs: nowMs }];
    }
    if (phase === "collapsing") {
      return [];
    }
    return [entry];
  });
}

export function useSubagentLifecycleStack(
  subagents: ReadonlyArray<OrchestrationSubagentSummary>,
): SubagentLifecycleStack {
  const [lifecycleNowMs, setLifecycleNowMs] = useState(() => Date.now());
  const partition = useMemo(
    () => partitionSubagentsByLifecycle({ subagents, nowMs: lifecycleNowMs }),
    [lifecycleNowMs, subagents],
  );
  const [visible, setVisible] = useState<ReadonlyArray<SubagentPresenceEntry>>(() =>
    initializeSubagentPresence(partition.visible, lifecycleNowMs),
  );

  useEffect(() => {
    setVisible((current) => reconcileSubagentPresence(current, partition.visible, Date.now()));
  }, [partition.visible]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const refreshClock = () => {
      setLifecycleNowMs(Date.now());
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshClock();
      }
    };
    const timeoutId =
      partition.nextTransitionAtMs === null
        ? null
        : window.setTimeout(
            refreshClock,
            Math.max(0, Math.min(MAX_TIMEOUT_MS, partition.nextTransitionAtMs - Date.now())),
          );

    window.addEventListener("focus", refreshClock);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("focus", refreshClock);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [lifecycleNowMs, partition.nextTransitionAtMs]);

  const hasReadyExit = visible.some((entry) => entry.phase === "exit-ready");
  useEffect(() => {
    if (typeof window === "undefined" || !hasReadyExit) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      setVisible((current) => beginReadySubagentExits(current, Date.now()));
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [hasReadyExit]);

  const presenceTransitionAtMs = nextPresenceTransitionAtMs(visible);
  useEffect(() => {
    if (typeof window === "undefined" || presenceTransitionAtMs === null) {
      return;
    }
    const timeoutId = window.setTimeout(
      () => {
        setVisible((current) => advanceSubagentPresence(current, Date.now()));
      },
      Math.max(0, Math.min(MAX_TIMEOUT_MS, presenceTransitionAtMs - Date.now())),
    );
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [presenceTransitionAtMs]);

  const completePhase = useCallback((subagentId: SubagentId, phase: SubagentPresencePhase) => {
    setVisible((current) => completePresencePhase(current, subagentId, phase, Date.now()));
  }, []);

  const archived = useMemo(() => {
    const retainedIds = new Set(visible.map((entry) => entry.agent.id));
    return partition.archived.filter((agent) => !retainedIds.has(agent.id));
  }, [partition.archived, visible]);

  return { visible, archived, completePhase };
}
