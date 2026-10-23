export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export function toPagination(page: number, limit: number): Pagination {
  return { page, limit, skip: (page - 1) * limit };
}

export function buildPageMeta({ page, limit }: Pagination, total: number): PageMeta {
  const totalPages = Math.ceil(total / limit);
  return { page, limit, total, totalPages, hasNext: page < totalPages };
}
