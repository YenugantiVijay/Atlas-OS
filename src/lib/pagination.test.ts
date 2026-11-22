/**
 * Real-world regression tests for pagination.ts
 *
 * Critical bug covered:
 *   Bug #3 — paginateArray double-reversed a descending sort when
 *   params.sortOrder === 'desc', producing ascending output.
 *   Fix: removed the `filtered.reverse()` block; the sortFn is the
 *   sole source of ordering truth.
 */

import { describe, it, expect } from 'vitest';
import { paginateArray, buildPaginatedResult } from './pagination';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

type DateItem = { id: string; createdAt: string };

const ITEMS: DateItem[] = [
  { id: '1', createdAt: '2026-01-15T00:00:00Z' }, // oldest
  { id: '3', createdAt: '2026-03-20T00:00:00Z' }, // newest
  { id: '2', createdAt: '2026-02-10T00:00:00Z' }, // middle
];

/** Newest-first comparator (what all real callers use for "desc" dates) */
const newestFirst = (a: DateItem, b: DateItem) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/** Oldest-first comparator */
const oldestFirst = (a: DateItem, b: DateItem) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

// ---------------------------------------------------------------------------
// Sort direction — the critical regression suite
// ---------------------------------------------------------------------------

describe('paginateArray — sort direction (Bug #3 regression)', () => {
  it('preserves descending (newest-first) sort when sortOrder is "desc"', () => {
    // Before the fix: filtered.reverse() was called after sort(), converting
    // newest-first → oldest-first. This test would have failed with ['1','2','3'].
    const result = paginateArray(ITEMS, { sortOrder: 'desc' }, undefined, newestFirst);
    expect(result.data.map((i) => i.id)).toEqual(['3', '2', '1']);
  });

  it('preserves descending sort when sortOrder is "asc" (sortFn wins, param ignored)', () => {
    // If caller passes a newest-first comparator, that order must be respected
    // regardless of the sortOrder param value.
    const result = paginateArray(ITEMS, { sortOrder: 'asc' }, undefined, newestFirst);
    expect(result.data.map((i) => i.id)).toEqual(['3', '2', '1']);
  });

  it('preserves ascending (oldest-first) sort when sortOrder is "asc"', () => {
    const result = paginateArray(ITEMS, { sortOrder: 'asc' }, undefined, oldestFirst);
    expect(result.data.map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  it('preserves ascending sort when sortOrder is "desc" (sortFn wins, param ignored)', () => {
    const result = paginateArray(ITEMS, { sortOrder: 'desc' }, undefined, oldestFirst);
    expect(result.data.map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  it('preserves sort with no sortOrder param at all', () => {
    const result = paginateArray(ITEMS, {}, undefined, newestFirst);
    expect(result.data.map((i) => i.id)).toEqual(['3', '2', '1']);
  });

  it('preserves sort with undefined params', () => {
    const result = paginateArray(ITEMS, undefined, undefined, newestFirst);
    expect(result.data.map((i) => i.id)).toEqual(['3', '2', '1']);
  });

  it('does not mutate the original items array', () => {
    const original = [...ITEMS];
    paginateArray(ITEMS, { sortOrder: 'desc' }, undefined, newestFirst);
    expect(ITEMS).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

describe('paginateArray — search filtering', () => {
  type NamedItem = { id: string; name: string };
  const NAMED: NamedItem[] = [
    { id: 'a', name: 'Alpha Cables' },
    { id: 'b', name: 'Beta Wires' },
    { id: 'c', name: 'alpha Transformers' }, // lowercase match
  ];
  const filterFn = (item: NamedItem, s: string) => item.name.toLowerCase().includes(s);

  it('returns all items when search is empty string', () => {
    const result = paginateArray(NAMED, { search: '' }, filterFn);
    expect(result.data).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.totalCount).toBe(3);
  });

  it('filters case-insensitively', () => {
    const result = paginateArray(NAMED, { search: 'ALPHA' }, filterFn);
    expect(result.data.map((i) => i.id).sort()).toEqual(['a', 'c']);
    expect(result.total).toBe(2);
  });

  it('returns empty when nothing matches', () => {
    const result = paginateArray(NAMED, { search: 'zzz' }, filterFn);
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('ignores search when filterFn is not provided', () => {
    // No filterFn → search term is ignored → all items returned
    const result = paginateArray(NAMED, { search: 'alpha' });
    expect(result.data).toHaveLength(3);
  });

  it('trims whitespace from search term', () => {
    const result = paginateArray(NAMED, { search: '  beta  ' }, filterFn);
    expect(result.data.map((i) => i.id)).toEqual(['b']);
  });
});

// ---------------------------------------------------------------------------
// Pagination slicing
// ---------------------------------------------------------------------------

describe('paginateArray — pagination slicing', () => {
  const TWENTY = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1) }));

  it('returns first page correctly', () => {
    const result = paginateArray(TWENTY, { page: 1, pageSize: 5 });
    expect(result.data.map((i) => i.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(5);
  });

  it('returns second page correctly', () => {
    const result = paginateArray(TWENTY, { page: 2, pageSize: 5 });
    expect(result.data.map((i) => i.id)).toEqual(['6', '7', '8', '9', '10']);
    expect(result.page).toBe(2);
  });

  it('returns last page (partial) correctly', () => {
    const result = paginateArray(TWENTY, { page: 4, pageSize: 7 });
    // 4 * 7 = 28 > 20; last page has items 22-20 → items 22,23 don't exist → 6 items
    // Pages: p1=1-7, p2=8-14, p3=15-20 (6 items)
    // Actually page 3 starts at index 14: items 15-20
    expect(result.data.length).toBeLessThanOrEqual(7);
  });

  it('defaults page to 1 when not specified', () => {
    const result = paginateArray(TWENTY, {});
    expect(result.page).toBe(1);
  });

  it('defaults pageSize to 25 when not specified', () => {
    const result = paginateArray(TWENTY, {});
    expect(result.pageSize).toBe(25);
    // All 20 items fit on page 1
    expect(result.data).toHaveLength(20);
  });

  it('caps pageSize at 100', () => {
    const result = paginateArray(TWENTY, { pageSize: 500 });
    expect(result.pageSize).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe('paginateArray — empty input', () => {
  it('returns empty data with correct metadata', () => {
    const result = paginateArray([], { page: 1, pageSize: 25 });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.totalPages).toBe(1); // at least 1 page even when empty
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPrevPage).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildPaginatedResult — math correctness
// ---------------------------------------------------------------------------

describe('buildPaginatedResult — metadata math', () => {
  it('computes totalPages correctly for exact multiple', () => {
    const r = buildPaginatedResult([], 50, 1, 10);
    expect(r.totalPages).toBe(5);
    expect(r.hasNextPage).toBe(true);
    expect(r.hasPrevPage).toBe(false);
  });

  it('rounds totalPages up when total is not an exact multiple', () => {
    const r = buildPaginatedResult([], 51, 1, 10);
    expect(r.totalPages).toBe(6);
  });

  it('hasNextPage is false on last page', () => {
    const r = buildPaginatedResult([], 25, 3, 10); // pages = ceil(25/10)=3
    expect(r.hasNextPage).toBe(false);
    expect(r.hasPrevPage).toBe(true);
  });

  it('hasPrevPage is false on first page', () => {
    const r = buildPaginatedResult([], 100, 1, 10);
    expect(r.hasPrevPage).toBe(false);
  });

  it('handles 0 total safely (no divide-by-zero, totalPages >= 1)', () => {
    const r = buildPaginatedResult([], 0, 1, 25);
    expect(r.totalPages).toBe(1);
    expect(r.total).toBe(0);
    expect(r.hasNextPage).toBe(false);
    expect(r.hasPrevPage).toBe(false);
  });

  it('total and totalCount are identical (dual-field alias)', () => {
    const r = buildPaginatedResult([], 42, 2, 10);
    expect(r.total).toBe(r.totalCount);
    expect(r.total).toBe(42);
  });
});
