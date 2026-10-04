/**
 * WhatsApp connection lifecycle — everything §5 E1/E2/E4/E5 of
 * docs/modules/whatsapp-meta-connection-implementation-plan.md needs beyond the
 * plain CRUD `lib/data/whatsapp-repository.ts` already had: resolving a
 * Mode A integration by its keyed webhook slug, advancing
 * `onboarding_step`, and writing the append-only connection-event audit
 * trail.
 *
 * Same posture as `whatsapp-repository.ts`: every function here takes the
 * service-role admin client and filters on `agency_id`/`connection_key`
 * explicitly, because there is no session (and therefore no RLS) behind
 * either the webhook or the connect Server Actions that call these before
 * a session's own agency is even resolved on a fresh connect.
 */

import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any -- matches the Db convention in every other lib/data/*-repository.ts */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

import type { WhatsAppIntegrationRow, WhatsAppOnboardingStep } from "@/lib/types/whatsapp";

export type Db = SupabaseClient<any, any, any>;

export class WhatsAppConnectionError extends Error {
  constructor(table: string, op: string, cause: unknown) {
    super(`whatsapp_connection.${table}.${op} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "WhatsAppConnectionError";
  }
}

/** D3 — an opaque, unguessable slug for the Mode A keyed webhook route. Never derived from anything guessable (agency id, phone number). */
export function generateConnectionKey(): string {
  return randomBytes(24).toString("base64url");
}

/** D5 — never 000000, never predictable. Meta's two-step PIN is exactly 4-6 digits; we use 6. */
export function generateTwoStepPin(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** Resolves a Mode A integration by its keyed webhook slug — the only identity the keyed route has to go on (D3). */
export async function getIntegrationByConnectionKey(db: Db, connectionKey: string): Promise<WhatsAppIntegrationRow | null> {
  const { data, error } = await db
    .from("whatsapp_integrations")
    .select("*")
    .eq("connection_key", connectionKey)
    .maybeSingle();
  if (error) throw new WhatsAppConnectionError("whatsapp_integrations", "select_by_key", error);
  return (data as WhatsAppIntegrationRow | null) ?? null;
}

/**
 * Marks the first signed, phone-resolved webhook as the end of onboarding.
 * The conditional update makes concurrent Meta deliveries idempotent and
 * lets the caller write exactly one WEBHOOK_VERIFIED audit event.
 */
export async function markWebhookVerified(
  db: Db,
  integrationId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("whatsapp_integrations")
    .update({ webhook_verified_at: now, onboarding_step: "COMPLETE" })
    .eq("id", integrationId)
    .is("webhook_verified_at", null)
    .select("id")
    .maybeSingle();

  if (error) throw new WhatsAppConnectionError("whatsapp_integrations", "mark_webhook_verified", error);
  return Boolean(data);
}

export async function getIntegrationById(db: Db, integrationId: string): Promise<WhatsAppIntegrationRow | null> {
  const { data, error } = await db.from("whatsapp_integrations").select("*").eq("id", integrationId).maybeSingle();
  if (error) throw new WhatsAppConnectionError("whatsapp_integrations", "select_by_id", error);
  return (data as WhatsAppIntegrationRow | null) ?? null;
}

export async function advanceOnboardingStep(
  db: Db,
  integrationId: string,
  step: WhatsAppOnboardingStep,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db
    .from("whatsapp_integrations")
    .update({ onboarding_step: step, ...patch })
    .eq("id", integrationId);
  if (error) throw new WhatsAppConnectionError("whatsapp_integrations", "advance_onboarding_step", error);
}

/** §5 E1 — the append-only trail: every onboarding step and every platform-state change lands here, integration-scoped and agency-scoped. */
export async function recordConnectionEvent(
  db: Db,
  input: { agencyId: string; integrationId?: string | null; kind: string; detail?: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.from("whatsapp_connection_events").insert({
    agency_id: input.agencyId,
    integration_id: input.integrationId ?? null,
    kind: input.kind,
    detail: input.detail ?? {},
  });
  if (error) throw new WhatsAppConnectionError("whatsapp_connection_events", "insert", error);
}

export async function listConnectionEvents(db: Db, agencyId: string, limit = 50) {
  const { data, error } = await db
    .from("whatsapp_connection_events")
    .select("*")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new WhatsAppConnectionError("whatsapp_connection_events", "select_recent", error);
  return data ?? [];
}

/** Every CONNECTED (or degraded-but-still-connected) integration — used by the health cron (E6) and the billing sync (E10). */
export async function listActiveIntegrations(db: Db): Promise<WhatsAppIntegrationRow[]> {
  const { data, error } = await db
    .from("whatsapp_integrations")
    .select("*")
    .in("status", ["CONNECTED", "UNFUNDED", "PENDING_REVIEW", "RESTRICTED"])
    .not("credential_ref", "is", null);
  if (error) throw new WhatsAppConnectionError("whatsapp_integrations", "select_active", error);
  return (data ?? []) as WhatsAppIntegrationRow[];
}
