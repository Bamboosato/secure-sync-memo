import { describe, expect, it } from 'vitest';
import {
  MIN_SORT_ORDER_GAP,
  type OrderableNote,
  SORT_ORDER_STEP,
  compareNotesInSection,
  computeReorderUpdate,
  computeTopSortOrder,
  getEffectiveSortOrder,
  splitAndSortNotes,
} from './noteOrdering';

function ts(ms: number) {
  return { toMillis: () => ms };
}

function makeNote(
  id: string,
  options: {
    isPinned?: boolean;
    sortOrder?: number | null;
    updatedAtMs?: number | null;
    createdAtMs?: number | null;
  } = {},
): OrderableNote {
  return {
    id,
    isPinned: options.isPinned ?? false,
    sortOrder: options.sortOrder ?? null,
    updatedAt: options.updatedAtMs != null ? ts(options.updatedAtMs) : null,
    createdAt: options.createdAtMs != null ? ts(options.createdAtMs) : null,
  };
}

function applyPlan(notes: OrderableNote[], updates: ReadonlyArray<{ id: string; sortOrder: number }>) {
  const updateMap = new Map(updates.map((u) => [u.id, u.sortOrder]));
  return notes
    .map((note) =>
      updateMap.has(note.id) ? { ...note, sortOrder: updateMap.get(note.id)! } : note,
    )
    .sort(compareNotesInSection);
}

describe('noteOrdering', () => {
  it('splits pinned and unpinned notes and sorts descending with legacy updatedAt fallback', () => {
    const notes = [
      makeNote('legacy-old', { updatedAtMs: 1000 }),
      makeNote('pinned-low', { isPinned: true, sortOrder: 2000, updatedAtMs: 5000 }),
      makeNote('unpinned-custom', { sortOrder: 3000, updatedAtMs: 500 }),
      makeNote('pinned-high', { isPinned: true, sortOrder: 4000, updatedAtMs: 1000 }),
      makeNote('legacy-new', { updatedAtMs: 2500 }),
    ];

    const { pinnedNotes, unpinnedNotes } = splitAndSortNotes(notes);

    expect(pinnedNotes.map((n) => n.id)).toEqual(['pinned-high', 'pinned-low']);
    expect(unpinnedNotes.map((n) => n.id)).toEqual([
      'unpinned-custom',
      'legacy-new',
      'legacy-old',
    ]);
  });

  it('uses deterministic tie-breaking when sortOrder and updatedAt match', () => {
    const notes = [
      makeNote('note-b', { updatedAtMs: 1000 }),
      makeNote('note-a', { updatedAtMs: 1000 }),
    ];
    const sorted = [...notes].sort(compareNotesInSection);
    expect(sorted.map((n) => n.id)).toEqual(['note-a', 'note-b']);
  });

  it('computes top sortOrder using nowMs for empty section and max + step for non-empty section', () => {
    expect(computeTopSortOrder([], 123456)).toBe(123456);

    const section = [
      makeNote('a', { sortOrder: 5000 }),
      makeNote('legacy', { updatedAtMs: 9000 }),
    ];
    expect(getEffectiveSortOrder(section[1]!)).toBe(9000);
    expect(computeTopSortOrder(section, 123456)).toBe(9000 + SORT_ORDER_STEP);
  });

  it('produces a single-write reorder plan when moving to top, middle, or bottom', () => {
    const initial = [
      makeNote('a', { sortOrder: 4000 }),
      makeNote('b', { sortOrder: 3000 }),
      makeNote('c', { sortOrder: 2000 }),
      makeNote('d', { sortOrder: 1000 }),
    ];

    const toTop = computeReorderUpdate(initial, 'c', 'a');
    expect(toTop).not.toBeNull();
    expect(toTop?.mode).toBe('single');
    expect(toTop?.updates).toHaveLength(1);
    expect(applyPlan(initial, toTop!.updates).map((n) => n.id)).toEqual(['c', 'a', 'b', 'd']);

    const toBottom = computeReorderUpdate(initial, 'a', 'd');
    expect(toBottom?.mode).toBe('single');
    expect(toBottom?.updates).toHaveLength(1);
    expect(applyPlan(initial, toBottom!.updates).map((n) => n.id)).toEqual(['b', 'c', 'd', 'a']);

    const toMiddle = computeReorderUpdate(initial, 'd', 'b');
    expect(toMiddle?.mode).toBe('single');
    expect(toMiddle?.updates).toHaveLength(1);
    expect(toMiddle?.updates[0]).toEqual({ id: 'd', sortOrder: 3500 });
    expect(applyPlan(initial, toMiddle!.updates).map((n) => n.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('returns null for no-op or cross-section ids', () => {
    const section = [makeNote('a', { sortOrder: 2000 }), makeNote('b', { sortOrder: 1000 })];

    expect(computeReorderUpdate(section, 'a', 'a')).toBeNull();
    expect(computeReorderUpdate(section, 'a', 'from-other-section')).toBeNull();
    expect(computeReorderUpdate(section, 'from-other-section', 'a')).toBeNull();
  });

  it('falls back to full-section rebalance when gap is below MIN_SORT_ORDER_GAP or legacy timestamps collide', () => {
    const tight = [
      makeNote('a', { sortOrder: 1000 + MIN_SORT_ORDER_GAP / 2 }),
      makeNote('b', { sortOrder: 1000 }),
      makeNote('c', { sortOrder: 500 }),
    ];

    const plan = computeReorderUpdate(tight, 'c', 'b');
    expect(plan).not.toBeNull();
    expect(plan?.mode).toBe('rebalance');
    expect(plan?.updates).toHaveLength(3);
    expect(applyPlan(tight, plan!.updates).map((n) => n.id)).toEqual(['a', 'c', 'b']);

    const collidedLegacy = [
      makeNote('a', { updatedAtMs: 5000 }),
      makeNote('b', { updatedAtMs: 5000 }),
      makeNote('c', { updatedAtMs: 5000 }),
    ];
    const legacyPlan = computeReorderUpdate(collidedLegacy, 'c', 'b');
    expect(legacyPlan?.mode).toBe('rebalance');
    expect(applyPlan(collidedLegacy, legacyPlan!.updates).map((n) => n.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });
});
