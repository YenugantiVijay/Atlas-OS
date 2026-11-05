import { PaginationParams, PaginatedResult } from '@/types';

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): PaginatedResult<T> {
  const safePage = Math.max(1, page || 1);
  const safePageSize = Math.max(1, pageSize || 25);
  const safeTotal = Math.max(0, total || 0);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));

  return {
    data,
    page: safePage,
    pageSize: safePageSize,
    total: safeTotal,
    totalCount: safeTotal,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
  };
}

export function paginateArray<T>(
  items: T[],
  params?: PaginationParams,
  filterFn?: (item: T, search: string) => boolean,
  sortFn?: (a: T, b: T) => number
): PaginatedResult<T> {
  let filtered = [...items];

  if (params?.search && params.search.trim() && filterFn) {
    const s = params.search.trim().toLowerCase();
    filtered = filtered.filter((item) => filterFn(item, s));
  }

  if (sortFn) {
    filtered.sort(sortFn);
    if (params?.sortOrder === 'desc') {
      filtered.reverse();
    }
  }

  const page = Math.max(1, params?.page || 1);
  const pageSize = Math.max(1, Math.min(100, params?.pageSize || 25));
  const total = filtered.length;
  const startIndex = (page - 1) * pageSize;
  const data = filtered.slice(startIndex, startIndex + pageSize);

  return buildPaginatedResult(data, total, page, pageSize);
}
