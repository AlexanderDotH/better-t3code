import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

const DURATION_MS = 220;
const RETAIN_MS = DURATION_MS + 40;
const EMPTY_IDS: ReadonlySet<string> = new Set();
type RowMotion = { entering: ReadonlySet<string>; exiting: ReadonlySet<string> };
export const ChatRowMotionContext = createContext<RowMotion>({
  entering: EMPTY_IDS,
  exiting: EMPTY_IDS,
});

function mergeExitingRows(
  previous: readonly MessagesTimelineRow[],
  next: MessagesTimelineRow[],
  exiting: ReadonlySet<string>,
) {
  const nextIds = new Set(next.map((row) => row.id));
  const before = new Map<string | null, MessagesTimelineRow[]>();
  let anchor: string | null = null;
  for (let index = previous.length - 1; index >= 0; index--) {
    const row = previous[index]!;
    if (nextIds.has(row.id)) anchor = row.id;
    else if (exiting.has(row.id)) {
      const group = before.get(anchor) ?? [];
      group.unshift(row);
      before.set(anchor, group);
    }
  }
  return [
    ...next.flatMap((row) => [...(before.get(row.id) ?? []), row]),
    ...(before.get(null) ?? []),
  ];
}

/** Retain removed rows only during a disclosure/status change, never during history restoration. */
export function useChatRowPresence(
  source: MessagesTimelineRow[],
  identity: string,
  enabled: boolean,
  foldRevision?: ReadonlySet<unknown>,
) {
  const [stored, setStored] = useState(() => ({
    source,
    rows: source,
    identity,
    enabled,
    foldRevision,
    entering: EMPTY_IDS,
    exiting: EMPTY_IDS,
    deadline: 0,
  }));
  let state = stored;
  if (stored.source !== source || stored.identity !== identity || stored.enabled !== enabled) {
    const reset = !enabled || !stored.enabled || stored.identity !== identity;
    const sameStructure =
      stored.foldRevision === foldRevision &&
      source.length === stored.source.length &&
      source[0]?.id === stored.source[0]?.id &&
      source.at(-1)?.id === stored.source.at(-1)?.id;
    if (reset || (!stored.deadline && sameStructure)) {
      state = {
        ...stored,
        source,
        rows: source,
        identity,
        enabled,
        foldRevision,
        entering: EMPTY_IDS,
        exiting: EMPTY_IDS,
        deadline: 0,
      };
    } else {
      const previousById = new Map(stored.source.map((row) => [row.id, row]));
      const nextIds = new Set(source.map((row) => row.id));
      const foldChanged =
        !reset &&
        source.some((row) => {
          const prior = previousById.get(row.id);
          return (
            row.kind === "turn-fold" &&
            prior?.kind === "turn-fold" &&
            row.expanded !== prior.expanded
          );
        });
      const transient = (row: MessagesTimelineRow) =>
        row.kind === "thinking" || row.kind === "working";
      const statusChanged =
        !reset &&
        (source.some((row) => transient(row) && !previousById.has(row.id)) ||
          stored.source.some((row) => transient(row) && !nextIds.has(row.id)));
      const changed = foldChanged || statusChanged;
      const retain = !reset && (changed || stored.deadline > Date.now());
      const exiting = retain
        ? new Set(
            stored.rows
              .filter(
                (row) =>
                  !nextIds.has(row.id) &&
                  (foldChanged || transient(row) || stored.exiting.has(row.id)),
              )
              .map((row) => row.id),
          )
        : EMPTY_IDS;
      const entering = retain
        ? new Set(
            source
              .filter(
                (row) =>
                  stored.exiting.has(row.id) ||
                  (stored.entering.has(row.id) && stored.deadline > Date.now()) ||
                  (!previousById.has(row.id) && (foldChanged || transient(row))),
              )
              .map((row) => row.id),
          )
        : EMPTY_IDS;
      const moving = entering.size > 0 || exiting.size > 0;
      state = {
        source,
        identity,
        enabled,
        foldRevision,
        rows: exiting.size ? mergeExitingRows(stored.rows, source, exiting) : source,
        entering: moving ? entering : EMPTY_IDS,
        exiting: moving ? exiting : EMPTY_IDS,
        deadline: moving ? (changed ? Date.now() + RETAIN_MS : stored.deadline) : 0,
      };
    }
    setStored(state);
  }
  const deadline = state.deadline;
  useEffect(() => {
    if (!deadline) return;
    const timer = setTimeout(
      () =>
        setStored((current) =>
          current.deadline === deadline
            ? {
                ...current,
                rows: current.source,
                entering: EMPTY_IDS,
                exiting: EMPTY_IDS,
                deadline: 0,
              }
            : current,
        ),
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [deadline]);
  return state;
}

export function ChatTimelineRowMotion({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className: string;
}) {
  const motion = useContext(ChatRowMotionContext);
  const entering = motion.entering.has(id);
  const exiting = motion.exiting.has(id);
  const ref = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const interrupted = animation.current ? element.getBoundingClientRect().height : null;
    animation.current?.cancel();
    animation.current = null;
    element.style.removeProperty("overflow");
    element.style.removeProperty("height");
    if ((!entering && !exiting) || !element.animate) return;
    const bounds = element.getBoundingClientRect();
    if (
      document.visibilityState !== "visible" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      bounds.bottom <= 0 ||
      bounds.top >= window.innerHeight
    ) {
      if (exiting) element.style.height = "0px";
      return;
    }
    element.style.removeProperty("height");
    element.style.overflow = "clip";
    const next = element.animate(
      {
        height: [
          `${interrupted ?? (entering ? 0 : bounds.height)}px`,
          `${exiting ? 0 : bounds.height}px`,
        ],
        opacity: exiting ? [1, 0] : [0, 1],
      },
      { duration: DURATION_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" },
    );
    animation.current = next;
    next.onfinish = () => {
      if (animation.current !== next || exiting) return;
      next.cancel();
      animation.current = null;
      element.style.removeProperty("overflow");
    };
  }, [id, entering, exiting]);
  useEffect(() => () => animation.current?.cancel(), []);
  return (
    <div
      ref={ref}
      className={className}
      data-timeline-root="true"
      inert={exiting}
      aria-hidden={exiting || undefined}
    >
      {children}
    </div>
  );
}
