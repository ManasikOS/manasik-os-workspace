/**
 * Cross-pilgrim read access for `/support-incidents`.
 *
 * `pilgrim_support_requests` and its mutations (`createSupportRequestAction`,
 * `updateSupportRequestStatusAction` in `app/(main)/pilgrims/actions.ts`)
 * already exist and are fully wired on the pilgrim's own Support tab — this
 * file only adds the missing cross-pilgrim, cross-group read so a case can
 * be triaged without opening one pilgrim at a time. No new table, no new
 * mutation.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  PilgrimSupportCategory,
  PilgrimSupportPriority,
  PilgrimSupportStatus,
} from "@/lib/types/pilgrims";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class SupportPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`Support: ${operation} on ${table} failed — ${detail}`);
  }
}

export interface CrossPilgrimSupportRow {
  id: string;
  pilgrimId: string;
  pilgrimName: string;
  departureGroupId: string | null;
  groupName: string | null;
  groupCode: string | null;
  title: string;
  detail: string | null;
  category: PilgrimSupportCategory;
  priority: PilgrimSupportPriority;
  status: PilgrimSupportStatus;
  assignedRole: string;
  raisedByPortal: boolean;
  createdAt: string;
  resolvedAt: string | null;
  slaDueAt: string | null;
  escalatedAt: string | null;
  escalatedToRole: string | null;
  supplierId: string | null;
  supplierName: string | null;
}

/** Every support request across every pilgrim, newest first. */
export async function listAllSupportRequests(client: Db): Promise<CrossPilgrimSupportRow[]> {
  const { data, error } = await client
    .from("pilgrim_support_requests")
    .select(
      `id, pilgrim_id, departure_group_id, title, detail, category, priority,
       status, assigned_role, raised_by_portal, created_at, resolved_at,
       sla_due_at, escalated_at, escalated_to_role, supplier_id,
       pilgrims:pilgrim_id ( full_name ),
       departure_groups:departure_group_id ( group_name, group_code ),
       suppliers:supplier_id ( name )`,
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) throw new SupportPersistenceError("pilgrim_support_requests", "select", error);

  interface RawRow {
    id: string;
    pilgrim_id: string;
    departure_group_id: string | null;
    title: string;
    detail: string | null;
    category: PilgrimSupportCategory;
    priority: PilgrimSupportPriority;
    status: PilgrimSupportStatus;
    assigned_role: string;
    raised_by_portal: boolean;
    created_at: string;
    resolved_at: string | null;
    sla_due_at: string | null;
    escalated_at: string | null;
    escalated_to_role: string | null;
    supplier_id: string | null;
    pilgrims: { full_name: string } | null;
    departure_groups: { group_name: string; group_code: string } | null;
    suppliers: { name: string } | null;
  }

  return ((data ?? []) as unknown as RawRow[]).map((row) => ({
    id: row.id,
    pilgrimId: row.pilgrim_id,
    pilgrimName: row.pilgrims?.full_name ?? "—",
    departureGroupId: row.departure_group_id,
    groupName: row.departure_groups?.group_name ?? null,
    groupCode: row.departure_groups?.group_code ?? null,
    title: row.title,
    detail: row.detail,
    category: row.category,
    priority: row.priority,
    status: row.status,
    assignedRole: row.assigned_role,
    raisedByPortal: row.raised_by_portal,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    slaDueAt: row.sla_due_at,
    escalatedAt: row.escalated_at,
    escalatedToRole: row.escalated_to_role,
    supplierId: row.supplier_id,
    supplierName: row.suppliers?.name ?? null,
  } satisfies CrossPilgrimSupportRow));
}
