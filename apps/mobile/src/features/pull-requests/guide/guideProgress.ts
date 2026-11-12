export type GuideProgress = {
  readonly position: number;
  readonly readStops: ReadonlySet<number>;
};
export const EMPTY_GUIDE_PROGRESS: GuideProgress = { position: 0, readStops: new Set() };

export function setGuideStopRead(
  current: GuideProgress,
  position: number,
  read: boolean,
  count: number,
): GuideProgress {
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position >= count ||
    current.readStops.has(position) === read
  )
    return current;
  const readStops = new Set(current.readStops);
  if (read) readStops.add(position);
  else readStops.delete(position);
  return { ...current, readStops };
}

export function moveGuideProgress(
  current: GuideProgress,
  requested: number,
  count: number,
  markCurrentRead = false,
): GuideProgress {
  const position = Math.max(
    0,
    Math.min(Number.isFinite(requested) ? Math.trunc(requested) : 0, Math.max(0, count - 1)),
  );
  const next = markCurrentRead ? setGuideStopRead(current, current.position, true, count) : current;
  return next.position === position ? next : { ...next, position };
}

export const guideProgressVersion = (guide: {
  readonly headSha: string;
  readonly generatedAt: string;
}) => JSON.stringify([guide.headSha, guide.generatedAt]);
