import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

export interface PaginationQuery {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

interface CursorPayload {
  sortValue: string;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
}

/**
 * Cursor-based pagination ordered by (sortColumn, id) — avoids the "shifting page" problem of
 * OFFSET pagination when new rows are inserted concurrently, and never runs an unbounded query.
 * `sortColumn` must be a not-null, monotonically-assigned timestamp column on the entity.
 */
export async function paginateByColumn<
  T extends ObjectLiteral & { id: string },
>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  sortColumn: string,
  query: PaginationQuery,
  order: 'ASC' | 'DESC' = 'DESC',
): Promise<PaginatedResult<T>> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
  const snakeColumn = sortColumn.replace(
    /[A-Z]/g,
    (letter) => `_${letter.toLowerCase()}`,
  );

  if (query.cursor) {
    const { sortValue, id } = decodeCursor(query.cursor);
    const op = order === 'DESC' ? '<' : '>';
    qb.andWhere(
      `(${alias}."${snakeColumn}" ${op} :cSortValue OR (${alias}."${snakeColumn}" = :cSortValue AND ${alias}.id ${op} :cId))`,
      { cSortValue: sortValue, cId: id },
    );
  }

  qb.orderBy(`${alias}.${sortColumn}`, order)
    .addOrderBy(`${alias}.id`, order)
    .take(limit + 1);

  const rows = await qb.getMany();
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1] as
    (T & Record<string, unknown>) | undefined;
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          sortValue: (last[sortColumn] as Date).toISOString(),
          id: last.id,
        })
      : null;

  return { items, nextCursor };
}

export const paginateByCreatedAt = <
  T extends ObjectLiteral & { id: string; createdAt: Date },
>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  query: PaginationQuery,
  order: 'ASC' | 'DESC' = 'DESC',
) => paginateByColumn(qb, alias, 'createdAt', query, order);
