import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const COLLECTION_SCHEMA_VERSION = 1;

export function paginationInput() {
  return {
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional()
      .describe(`Maximum results to return (default ${DEFAULT_PAGE_SIZE}, maximum ${MAX_PAGE_SIZE}).`),
    offset: z.number().int().min(0).optional()
      .describe('Zero-based result offset. Use page.nextOffset from the previous response.'),
  };
}

export function normalizePagination({ limit, offset } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  return { limit: safeLimit, offset: safeOffset };
}

export function pageEnvelope(items, total, args = {}) {
  const { limit, offset } = normalizePagination(args);
  const safeItems = Array.isArray(items) ? items : [];
  const safeTotal = Number.isInteger(total) && total >= 0 ? total : safeItems.length;
  const returned = safeItems.length;
  // An empty page can never advance the cursor: with returned === 0,
  // "hasMore" would emit nextOffset === offset and an agent following the
  // documented cursor contract loops forever on the same request.
  const hasMore = returned > 0 && offset + returned < safeTotal;

  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    items: safeItems,
    page: {
      offset,
      limit,
      returned,
      total: safeTotal,
      hasMore,
      nextOffset: hasMore ? offset + returned : null,
    },
  };
}

export function paginateResults(items, args = {}) {
  const list = Array.isArray(items) ? items : [];
  const { limit, offset } = normalizePagination(args);
  return pageEnvelope(list.slice(offset, offset + limit), list.length, { limit, offset });
}
