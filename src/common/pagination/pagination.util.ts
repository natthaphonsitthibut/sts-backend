/** Page sizes the list UIs offer; keep in sync with the frontend controls. */
export const PAGE_SIZES = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;

export interface PaginationMeta {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export function resolvePage(page?: number): number {
  return page && page > 0 ? page : 1;
}

export function resolveLimit(limit?: number): number {
  return limit && limit > 0 ? limit : DEFAULT_PAGE_SIZE;
}

export function buildPaginationMeta(
  page: number,
  limit: number,
  totalCount: number,
): PaginationMeta {
  return {
    page,
    limit,
    totalCount,
    totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 0,
  };
}
