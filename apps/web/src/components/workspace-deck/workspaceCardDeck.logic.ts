export type WorkspaceDeckDirection = "forward" | "backward";
export type WorkspaceDeckPosition = "previous" | "active" | "next" | "hidden";
export type WorkspaceDeckSelectionMode = "animate" | "immediate";
export type WorkspaceDeckMotionMode = "fallback" | "morph";

export interface WorkspaceDeckCardRole<CardId extends string> {
  readonly id: CardId;
  readonly position: WorkspaceDeckPosition;
}

export interface WorkspaceDeckMorphRole<CardId extends string> {
  readonly id: CardId;
  readonly from: WorkspaceDeckPosition;
  readonly to: WorkspaceDeckPosition;
  readonly morph: "incoming" | "outgoing" | "orbiting";
}

export interface WorkspaceDeckTransition<CardId extends string> {
  readonly fromId: CardId;
  readonly toId: CardId;
  readonly direction: WorkspaceDeckDirection;
  readonly motion: WorkspaceDeckMotionMode;
  readonly token: number;
}

export interface WorkspaceDeckSelectionDecision<CardId extends string> {
  readonly activeCard: CardId;
  readonly cancelTransition: boolean;
  readonly changed: boolean;
  readonly direction: WorkspaceDeckDirection | null;
  readonly selectionMode: WorkspaceDeckSelectionMode | null;
}

function circularIndex(index: number, length: number): number {
  return (index + length) % length;
}

export function findDuplicateWorkspaceDeckCardId<CardId extends string>(
  cardIds: readonly CardId[],
): CardId | null {
  const seen = new Set<CardId>();
  for (const cardId of cardIds) {
    if (seen.has(cardId)) return cardId;
    seen.add(cardId);
  }
  return null;
}

export function resolveWorkspaceDeckRoles<CardId extends string>(
  cardIds: readonly CardId[],
  activeCard: CardId,
): readonly WorkspaceDeckCardRole<CardId>[] {
  const activeIndex = cardIds.indexOf(activeCard);
  if (activeIndex < 0) {
    return cardIds.map((id) => ({ id, position: "hidden" }));
  }

  if (cardIds.length === 2) {
    const otherIndex = activeIndex === 0 ? 1 : 0;
    const otherPosition = activeIndex === 0 ? "previous" : "next";
    return cardIds.map((id, index) => ({
      id,
      position: index === activeIndex ? "active" : index === otherIndex ? otherPosition : "hidden",
    }));
  }

  const previousIndex = circularIndex(activeIndex - 1, cardIds.length);
  const nextIndex = circularIndex(activeIndex + 1, cardIds.length);
  return cardIds.map((id, index) => ({
    id,
    position:
      index === activeIndex
        ? "active"
        : cardIds.length > 1 && index === previousIndex
          ? "previous"
          : cardIds.length > 1 && index === nextIndex
            ? "next"
            : "hidden",
  }));
}

export function resolveWorkspaceDeckDirection<CardId extends string>(
  cardIds: readonly CardId[],
  activeCard: CardId,
  requestedCard: CardId,
): WorkspaceDeckDirection | null {
  if (activeCard === requestedCard) return null;

  const roles = resolveWorkspaceDeckRoles(cardIds, activeCard);
  const requestedRole = roles.find((role) => role.id === requestedCard);
  if (!requestedRole || requestedRole.position === "active") return null;
  if (requestedRole.position === "previous") return "backward";
  if (requestedRole.position === "next") return "forward";

  const activeIndex = cardIds.indexOf(activeCard);
  const requestedIndex = cardIds.indexOf(requestedCard);
  if (activeIndex < 0 || requestedIndex < 0) return null;
  const forwardDistance = circularIndex(requestedIndex - activeIndex, cardIds.length);
  const backwardDistance = circularIndex(activeIndex - requestedIndex, cardIds.length);
  return forwardDistance <= backwardDistance ? "forward" : "backward";
}

export function resolveWorkspaceDeckMorphRoles<CardId extends string>(
  cardIds: readonly CardId[],
  fromCard: CardId,
  toCard: CardId,
): readonly WorkspaceDeckMorphRole<CardId>[] {
  const fromRoles = new Map(
    resolveWorkspaceDeckRoles(cardIds, fromCard).map((role) => [role.id, role.position]),
  );
  const toRoles = new Map(
    resolveWorkspaceDeckRoles(cardIds, toCard).map((role) => [role.id, role.position]),
  );

  return cardIds.flatMap((id) => {
    const from = fromRoles.get(id) ?? "hidden";
    const to = toRoles.get(id) ?? "hidden";
    if (from === to) return [];
    const morph = id === toCard ? "incoming" : id === fromCard ? "outgoing" : "orbiting";
    return [{ id, from, to, morph }];
  });
}

export function resolveWorkspaceDeckActiveCard<CardId extends string>(input: {
  readonly cardIds: readonly CardId[];
  readonly activeCard: string | null | undefined;
  readonly fallbackCard: string;
}): CardId | null {
  const activeCard = input.cardIds.find((cardId) => cardId === input.activeCard);
  if (activeCard !== undefined) return activeCard;
  return input.cardIds.find((cardId) => cardId === input.fallbackCard) ?? input.cardIds[0] ?? null;
}

export function resolveWorkspaceDeckSelection<CardId extends string>(input: {
  readonly cardIds: readonly CardId[];
  readonly activeCard: CardId;
  readonly requestedCard: string;
  readonly transitionActive: boolean;
  readonly priority?: boolean;
}): WorkspaceDeckSelectionDecision<CardId> {
  const requestedCard = input.cardIds.find((cardId) => cardId === input.requestedCard);
  if (requestedCard === undefined) return unchangedSelection(input.activeCard);

  if (requestedCard === input.activeCard) {
    return {
      ...unchangedSelection(input.activeCard),
      cancelTransition: Boolean(input.priority && input.transitionActive),
    };
  }

  if (input.priority) {
    return {
      activeCard: requestedCard,
      cancelTransition: input.transitionActive,
      changed: true,
      direction: null,
      selectionMode: "immediate",
    };
  }

  const direction = resolveWorkspaceDeckDirection(input.cardIds, input.activeCard, requestedCard);
  if (direction === null) return unchangedSelection(input.activeCard);
  return {
    activeCard: requestedCard,
    cancelTransition: input.transitionActive,
    changed: true,
    direction,
    selectionMode: "animate",
  };
}

function unchangedSelection<CardId extends string>(
  activeCard: CardId,
): WorkspaceDeckSelectionDecision<CardId> {
  return {
    activeCard,
    cancelTransition: false,
    changed: false,
    direction: null,
    selectionMode: null,
  };
}

export type WorkspaceDeckMeasurements = Readonly<Record<string, number | undefined>>;

function validHeight(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function resolveWorkspaceDeckCompactHeight<CardId extends string>(input: {
  readonly activeCard: CardId;
  readonly cardIds: readonly CardId[];
  readonly frozenHeight?: number | null;
  readonly referenceCard: CardId;
  readonly measurements: WorkspaceDeckMeasurements;
}): number | null {
  const frozenHeight = validHeight(input.frozenHeight);
  if (frozenHeight !== null) return frozenHeight;
  if (input.cardIds.length === 0) return null;

  const referenceHeight = input.cardIds.includes(input.referenceCard)
    ? validHeight(input.measurements[input.referenceCard])
    : null;
  if (referenceHeight !== null) return referenceHeight;
  return validHeight(input.measurements[input.activeCard]);
}

export function pruneWorkspaceDeckMeasurements<CardId extends string>(
  cardIds: readonly CardId[],
  measurements: WorkspaceDeckMeasurements,
): Partial<Record<CardId, number>> {
  const nextMeasurements: Partial<Record<CardId, number>> = {};
  for (const cardId of cardIds) {
    if (!Object.hasOwn(measurements, cardId)) continue;
    const height = validHeight(measurements[cardId]);
    if (height !== null) nextMeasurements[cardId] = height;
  }
  return nextMeasurements;
}

const WORKSPACE_DRAWER_DEFAULT_HEIGHT_RATIO = 0.62;
const WORKSPACE_DRAWER_MAX_HEIGHT_RATIO = 0.8;
const WORKSPACE_DRAWER_MIN_HEIGHT = 320;
const WORKSPACE_DRAWER_MIN_TIMELINE_HEIGHT = 160;

export interface WorkspaceCardDrawerHeightRequest {
  readonly availableHeight: number;
  readonly requestedHeight?: number;
}

export interface WorkspaceCardDrawerHeightBounds {
  readonly min: number;
  readonly max: number;
}

function normalizeDrawerAvailableHeight(availableHeight: number): number {
  return Number.isFinite(availableHeight) ? Math.max(0, Math.round(availableHeight)) : 0;
}

export function resolveWorkspaceCardDrawerHeightBounds(
  availableHeight: number,
): WorkspaceCardDrawerHeightBounds {
  const safeAvailableHeight = normalizeDrawerAvailableHeight(availableHeight);
  const maxByRatio = Math.floor(safeAvailableHeight * WORKSPACE_DRAWER_MAX_HEIGHT_RATIO);
  const maxByTimeline = Math.max(0, safeAvailableHeight - WORKSPACE_DRAWER_MIN_TIMELINE_HEIGHT);
  const max = Math.min(maxByRatio, maxByTimeline);
  return { min: Math.min(WORKSPACE_DRAWER_MIN_HEIGHT, max), max };
}

export function resolveWorkspaceCardDrawerHeight(
  request: WorkspaceCardDrawerHeightRequest,
): number {
  const bounds = resolveWorkspaceCardDrawerHeightBounds(request.availableHeight);
  const defaultHeight = Math.round(
    normalizeDrawerAvailableHeight(request.availableHeight) * WORKSPACE_DRAWER_DEFAULT_HEIGHT_RATIO,
  );
  const requestedHeight = Number.isFinite(request.requestedHeight)
    ? Math.round(request.requestedHeight ?? defaultHeight)
    : defaultHeight;
  return Math.min(Math.max(requestedHeight, bounds.min), bounds.max);
}

export function nextWorkspaceCardDrawerHeightFromPointer(input: {
  readonly availableHeight: number;
  readonly currentY: number;
  readonly startHeight: number;
  readonly startY: number;
}): number {
  return resolveWorkspaceCardDrawerHeight({
    availableHeight: input.availableHeight,
    requestedHeight: input.startHeight + (input.startY - input.currentY),
  });
}

export function parsePersistedWorkspaceCardDrawerHeight(value: string | null): number | null {
  if (value === null || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
