import type { Db } from "@/lib/ai/db";

/** A test double for the `inbox_template_send_claims` table: just the calls `template-send-claims.ts` makes, with the table's unique key. */
export interface FakeClaimRow {
  agency_id: string;
  idempotency_key: string;
  status: string;
  conversation_id: string | null;
  external_message_id: string | null;
  error: string | null;
  updated_at: string;
}

export function createFakeClaimsAdmin(options: { failInsertWith?: { code: string; message: string } } = {}) {
  const rows = new Map<string, FakeClaimRow>();
  const otherInserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const idOf = (agency: unknown, key: unknown) => `${String(agency)}:${String(key)}`;

  function claimsTable() {
    return {
      insert: async (row: Record<string, unknown>) => {
        if (options.failInsertWith) return { error: options.failInsertWith };
        const id = idOf(row.agency_id, row.idempotency_key);
        if (rows.has(id)) return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        rows.set(id, { agency_id: String(row.agency_id), idempotency_key: String(row.idempotency_key), status: "SENDING", conversation_id: null, external_message_id: null, error: null, updated_at: new Date().toISOString() });
        return { error: null };
      },
      select: () => {
        const filters: Record<string, unknown> = {};
        const query = { eq: (column: string, value: unknown) => { filters[column] = value; return query; }, maybeSingle: async () => ({ data: rows.get(idOf(filters.agency_id, filters.idempotency_key)) ?? null, error: null }) };
        return query;
      },
      update: (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const query: Record<string, unknown> = {};
        query.eq = (column: string, value: unknown) => { filters[column] = value; return query; };
        const apply = () => {
          const row = rows.get(idOf(filters.agency_id, filters.idempotency_key));
          if (!row || (filters.status !== undefined && row.status !== filters.status)) return [];
          Object.assign(row, patch);
          return [{ id: "row" }];
        };
        query.select = async () => ({ data: apply(), error: null });
        query.then = (resolve: (value: unknown) => unknown) => resolve({ data: apply(), error: null });
        return query;
      },
    };
  }

  const admin = {
    from: (table: string) => {
      if (table === "inbox_template_send_claims") return claimsTable();
      return { insert: async (row: Record<string, unknown>) => { otherInserts.push({ table, row }); return { error: null }; } };
    },
  } as unknown as Db;
  return { admin, rows, otherInserts };
}
