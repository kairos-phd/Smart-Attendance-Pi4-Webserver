export function latestFirst<T>(rows: T[], time: (row: T) => number): T[] {
  return [...rows].sort((a, b) => (time(b) || 0) - (time(a) || 0));
}
export function pageForRows(previous: string, current: string, page: number): number {
  return previous === current ? page : 0;
}
export function paginate<T>(rows: T[], size = 10, requested = 0) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.max(0, Math.min(requested, pages - 1));
  return { rows: rows.slice(page * size, (page + 1) * size), page, pages };
}
