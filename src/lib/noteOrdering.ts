export const SORT_ORDER_STEP = 1000;
export const MIN_SORT_ORDER_GAP = 0.001;
export const MAX_ABS_SORT_ORDER = 1e15;

export interface TimestampLike {
  toMillis(): number;
}

export interface OrderableNote {
  id: string;
  isPinned: boolean;
  sortOrder: number | null;
  updatedAt: TimestampLike | null;
  createdAt?: TimestampLike | null;
}

export interface SortOrderUpdate {
  id: string;
  sortOrder: number;
}

export interface ReorderPlan {
  mode: 'single' | 'rebalance';
  fromIndex: number;
  toIndex: number;
  updates: SortOrderUpdate[];
}

export function getEffectiveSortOrder(note: OrderableNote): number {
  if (typeof note.sortOrder === 'number' && Number.isFinite(note.sortOrder)) {
    return note.sortOrder;
  }
  return note.updatedAt?.toMillis() ?? note.createdAt?.toMillis() ?? 0;
}

export function compareNotesInSection(a: OrderableNote, b: OrderableNote): number {
  const orderDiff = getEffectiveSortOrder(b) - getEffectiveSortOrder(a);
  if (orderDiff !== 0) {
    return orderDiff;
  }

  const updatedDiff = (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0);
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  return a.id.localeCompare(b.id);
}

export function splitAndSortNotes<T extends OrderableNote>(
  notes: readonly T[],
): { pinnedNotes: T[]; unpinnedNotes: T[] } {
  const pinnedNotes: T[] = [];
  const unpinnedNotes: T[] = [];

  for (const note of notes) {
    if (note.isPinned) {
      pinnedNotes.push(note);
    } else {
      unpinnedNotes.push(note);
    }
  }

  pinnedNotes.sort(compareNotesInSection);
  unpinnedNotes.sort(compareNotesInSection);

  return { pinnedNotes, unpinnedNotes };
}

export function computeTopSortOrder(
  sectionNotes: readonly OrderableNote[],
  nowMs = Date.now(),
): number {
  if (sectionNotes.length === 0) {
    return nowMs;
  }

  let maxOrder = -Infinity;
  for (const note of sectionNotes) {
    const order = getEffectiveSortOrder(note);
    if (order > maxOrder) {
      maxOrder = order;
    }
  }

  const candidate = maxOrder + SORT_ORDER_STEP;
  if (Number.isFinite(candidate) && Math.abs(candidate) <= MAX_ABS_SORT_ORDER) {
    return candidate;
  }
  return Math.min(MAX_ABS_SORT_ORDER, Math.max(-MAX_ABS_SORT_ORDER, maxOrder));
}

export function computeReorderUpdate(
  sectionNotes: readonly OrderableNote[],
  activeId: string,
  overId: string,
): ReorderPlan | null {
  const fromIndex = sectionNotes.findIndex((note) => note.id === activeId);
  const toIndex = sectionNotes.findIndex((note) => note.id === overId);

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return null;
  }

  const reordered = [...sectionNotes];
  const [moved] = reordered.splice(fromIndex, 1);
  if (!moved) {
    return null;
  }
  reordered.splice(toIndex, 0, moved);

  const above = toIndex > 0 ? reordered[toIndex - 1] ?? null : null;
  const below = toIndex < reordered.length - 1 ? reordered[toIndex + 1] ?? null : null;

  let singleOrder: number | null = null;

  if (!above && below) {
    const belowOrder = getEffectiveSortOrder(below);
    const candidate = belowOrder + SORT_ORDER_STEP;
    if (
      Number.isFinite(candidate) &&
      Math.abs(candidate) <= MAX_ABS_SORT_ORDER &&
      candidate > belowOrder
    ) {
      singleOrder = candidate;
    }
  } else if (above && !below) {
    const aboveOrder = getEffectiveSortOrder(above);
    const candidate = aboveOrder - SORT_ORDER_STEP;
    if (
      Number.isFinite(candidate) &&
      Math.abs(candidate) <= MAX_ABS_SORT_ORDER &&
      candidate < aboveOrder
    ) {
      singleOrder = candidate;
    }
  } else if (above && below) {
    const aboveOrder = getEffectiveSortOrder(above);
    const belowOrder = getEffectiveSortOrder(below);
    const gap = aboveOrder - belowOrder;
    if (gap >= MIN_SORT_ORDER_GAP) {
      const mid = (aboveOrder + belowOrder) / 2;
      if (Number.isFinite(mid) && mid < aboveOrder && mid > belowOrder) {
        singleOrder = mid;
      }
    }
  }

  if (singleOrder !== null) {
    return {
      mode: 'single',
      fromIndex,
      toIndex,
      updates: [{ id: activeId, sortOrder: singleOrder }],
    };
  }

  const updates = reordered.map((note, idx) => ({
    id: note.id,
    sortOrder: (reordered.length - idx) * SORT_ORDER_STEP,
  }));

  return {
    mode: 'rebalance',
    fromIndex,
    toIndex,
    updates,
  };
}
