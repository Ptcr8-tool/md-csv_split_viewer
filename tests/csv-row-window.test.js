import { describe, it, expect } from 'vitest';
import { csvRowWindow, csvRowWindowForIndex, normalizeCsvPageRows } from '../src/csv-row-window.js';

describe('CSV row windows', () => {
  it('advances half a window, including when the last window is partial', () => {
    const first = csvRowWindow(175, 100);
    const second = csvRowWindow(175, 100, first.next);
    const last = csvRowWindow(175, 100, second.next);

    expect(first).toEqual({ start: 0, end: 100, previous: null, next: 50 });
    expect(second).toEqual({ start: 50, end: 150, previous: 0, next: 100 });
    expect(last).toEqual({ start: 100, end: 175, previous: 50, next: null });
    expect(csvRowWindow(175, 100, last.previous)).toEqual(second);
    expect(csvRowWindow(175, 100, second.previous)).toEqual(first);
  });

  it('honors custom sizes and updates bounds when filtering removes rows', () => {
    expect(normalizeCsvPageRows(undefined)).toBe(100);
    expect(normalizeCsvPageRows('')).toBe(100);
    expect(normalizeCsvPageRows('75')).toBe(75);
    expect(normalizeCsvPageRows(1)).toBe(10);
    expect(normalizeCsvPageRows(1000)).toBe(500);
    expect(csvRowWindow(156, 75)).toEqual({ start: 0, end: 75, previous: null, next: 37 });
    expect(csvRowWindow(156, 75, 50)).toEqual({ start: 37, end: 112, previous: 0, next: 74 });
    expect(csvRowWindow(80, 75, 111)).toEqual({ start: 37, end: 80, previous: 0, next: null });
    expect(csvRowWindow(75, 75, 37)).toEqual({ start: 0, end: 75, previous: null, next: null });
    expect(csvRowWindow(0, 75, 37)).toEqual({ start: 0, end: 0, previous: null, next: null });
  });

  it('keeps a visible target in place and finds an overlapping window for offscreen targets', () => {
    const current = csvRowWindow(230, 100, 50);
    expect(csvRowWindowForIndex(230, 100, current.start, 99)).toEqual(current);
    expect(csvRowWindowForIndex(230, 100, current.start, -1)).toEqual(current);
    expect(csvRowWindowForIndex(230, 100, current.start, 150).start).toBe(100);
    expect(csvRowWindowForIndex(230, 100, current.start, 49).start).toBe(0);
    expect(csvRowWindowForIndex(230, 100, current.start, 229)).toEqual({
      start: 150, end: 230, previous: 100, next: null,
    });
  });
});
