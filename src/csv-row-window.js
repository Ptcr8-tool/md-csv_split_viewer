export const CSV_PAGE_ROWS = 100;
export const MIN_CSV_PAGE_ROWS = 10;
export const MAX_CSV_PAGE_ROWS = 500;
export const UNLIMITED_CSV_PAGE_ROWS = 'unlimited';

export function normalizeCsvPageRows(value) {
  if (value === UNLIMITED_CSV_PAGE_ROWS) return value;
  if (typeof value === 'string' && value.trim()) value = Number(value);
  if (!Number.isSafeInteger(value)) return CSV_PAGE_ROWS;
  return Math.min(MAX_CSV_PAGE_ROWS, Math.max(MIN_CSV_PAGE_ROWS, value));
}

export function csvRowWindow(total, pageRows, start = 0) {
  const size = normalizeCsvPageRows(pageRows);
  if (size === UNLIMITED_CSV_PAGE_ROWS) return { start: 0, end: total, previous: null, next: null };
  const step = Math.floor(size / 2);
  const lastStart = Math.max(0, Math.ceil((total - size) / step) * step);
  const first = Math.min(lastStart, Math.max(0, Math.floor(start / step) * step));
  return {
    start: first,
    end: Math.min(total, first + size),
    previous: first > 0 ? first - step : null,
    next: first < lastStart ? first + step : null,
  };
}

export function csvRowWindowForIndex(total, pageRows, start, index) {
  const current = csvRowWindow(total, pageRows, start);
  if (!Number.isSafeInteger(index) || index < 0 || index >= total) return current;
  if (index >= current.start && index < current.end) return current;

  const size = normalizeCsvPageRows(pageRows);
  const step = Math.floor(size / 2);
  // Keep as many overlapping rows as possible when navigation leaves the window.
  const shift = index < current.start
    ? -Math.ceil((current.start - index) / step)
    : Math.ceil((index - current.end + 1) / step);
  return csvRowWindow(total, size, current.start + shift * step);
}
