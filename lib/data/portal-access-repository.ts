/**
 * Server-only read/write access for Pilgrim Portal access.
 *
 * Backed by `portal_accounts` / `portal_access_events` added in
 * `supabase/migrations/20261018090000_pilgrim_portal_access.sql`. See that
 * migration's header for why this is access-lifecycle tracking rather than
 * a real pilgrim-facing login.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PortalAccessEventRow, PortalAccountRow, PortalAccountStatus, PortalPilgrimSummary } from "@/lib/types/portal-access";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export class PortalAccessPersistenceError extends Error {
  constructor(
    readonly table: string,
    readonly operation: "select" | "insert" | "update" | "delete",
    cause: unknown,
  ) {
    const detail =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message: unknown }).message)
        : String(cause);
    super(`PortalAccess: ${operation} on ${table} failed — ${detail}`);
    this.name = "PortalAccessPersistenceError";
  }
}

export async function listPortalPilgrimSummaries(client: Db): Promise<PortalPilgrimSummary[]> {
  const [pilgrimsResult, accountsResult, eventsResult] = await Promise.all([
    client
      .from("pilgrims")
      .select("id, full_name, reference, whatsapp_number, journey_status")
      .order("full_name", { ascending: true }),
    client.from("portal_accounts").select("*"),
    client.from("portal_access_events").select("pilgrim_id"),
  ]);
  if (pilgrimsResult.error) throw new PortalAccessPersistenceError("pilgrims", "select", pilgrimsResult.error);
  if (accountsResult.error) throw new PortalAccessPersistenceError("portal_accounts", "select", accountsResult.error);
  if (eventsResult.error) throw new PortalAccessPersistenceError("portal_access_events", "select", eventsResult.error);

  const accountByPilgrim = new Map(
    ((accountsResult.data ?? []) as PortalAccountRow[]).map((a) => [a.pilgrim_id, a]),
  );
  const eventCountByPilgrim = new Map<string, number>();
  for (const row of (eventsResult.data ?? []) as { pilgrim_id: string }[]) {
    eventCountByPilgrim.set(row.pilgrim_id, (eventCountByPilgrim.get(row.pilgrim_id) ?? 0) + 1);
  }

  return (
    (pilgrimsResult.data ?? []) as {
      id: string;
      full_name: string;
      reference: string;
      whatsapp_number: string;
      journey_status: string;
    }[]
  ).map((p) => ({
    pilgrimId: p.id,
    fullName: p.full_name,
    reference: p.reference,
    whatsappNumber: p.whatsapp_number,
    journeyStatus: p.journey_status,
    account: accountByPilgrim.get(p.id) ?? null,
    eventCount: eventCountByPilgrim.get(p.id) ?? 0,
  }));
}

export async function listPortalAccessEvents(client: Db, pilgrimId: string): Promise<PortalAccessEventRow[]> {
  const { data, error } = await client
    .from("portal_access_events")
    .select("*")
    .eq("pilgrim_id", pilgrimId)
    .order("created_at", { ascending: false });
  if (error) throw new PortalAccessPersistenceError("portal_access_events", "select", error);
  return (data ?? []) as PortalAccessEventRow[];
}

async function logEvent(client: Db, pilgrimId: string, eventType: PortalAccessEventRow["event_type"], actorName: string) {
  const { error } = await client
    .from("portal_access_events")
    .insert({ pilgrim_id: pilgrimId, event_type: eventType, actor_name: actorName });
  if (error) throw new PortalAccessPersistenceError("portal_access_events", "insert", error);
}

export async function invitePilgrimToPortal(client: Db, pilgrimId: string, actorName: string): Promise<void> {
  const { error } = await client.from("portal_accounts").upsert(
    {
      pilgrim_id: pilgrimId,
      status: "INVITED" satisfies PortalAccountStatus,
      invited_at: new Date().toISOString(),
      invited_by_name: actorName,
      revoked_at: null,
      revoked_by_name: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "pilgrim_id" },
  );
  if (error) throw new PortalAccessPersistenceError("portal_accounts", "insert", error);
  await logEvent(client, pilgrimId, "INVITED", actorName);
}

export async function revokePilgrimPortalAccess(client: Db, pilgrimId: string, actorName: string): Promise<void> {
  const { error } = await client
    .from("portal_accounts")
    .update({
      status: "REVOKED" satisfies PortalAccountStatus,
      revoked_at: new Date().toISOString(),
      revoked_by_name: actorName,
      updated_at: new Date().toISOString(),
    })
    .eq("pilgrim_id", pilgrimId);
  if (error) throw new PortalAccessPersistenceError("portal_accounts", "update", error);
  await logEvent(client, pilgrimId, "REVOKED", actorName);
}

/** Manual override for staff confirming a pilgrim has started using an out-of-band activation (e.g. a phone call walkthrough). */
export async function markPilgrimPortalActivated(client: Db, pilgrimId: string, actorName: string): Promise<void> {
  const { error } = await client
    .from("portal_accounts")
    .update({ status: "ACTIVE" satisfies PortalAccountStatus, activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("pilgrim_id", pilgrimId);
  if (error) throw new PortalAccessPersistenceError("portal_accounts", "update", error);
  await logEvent(client, pilgrimId, "ACTIVATED", actorName);
}
