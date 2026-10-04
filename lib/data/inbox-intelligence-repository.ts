/**
 * The context rail's read — MI2.5 of docs/inbox/implementation-plan.md. One conversation's stored intelligence, its
 * live signals, the customer message the reading was based on, and whether the agency uses the triage surface at all.
 *
 * Runs on the caller's RLS-scoped client (staff only ever read their own agency's rows) and filters by agency as well.
 * Kept apart from the transcript and lead loaders on purpose: this is the fourth independent read, so a slow
 * projection can never hold up the messages.
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { listInterventions, listLiveSignals, loadIntelligence } from "@/lib/data/conversation-intelligence-repository";
import { checkStoredOffer } from "@/lib/data/inbox-offer-repository";
import type { InboxIntelligenceData } from "@/lib/inbox/intelligence/rail-view";

export const INBOX_TRIAGE_SURFACE_CODE = "INBOX_TRIAGE";
export const INBOX_RISK_SURFACE_CODE = "INBOX_RISK";
const DEFAULT_OFFER_MAX_AGE_MINUTES = 60;
const SNIPPET_MAX_CHARS = 300;

function snippetOf(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= SNIPPET_MAX_CHARS ? collapsed : `${Array.from(collapsed).slice(0, SNIPPET_MAX_CHARS - 1).join("")}…`;
}

export async function assembleInboxIntelligence(db: Db, agencyId: string, conversationId: string): Promise<InboxIntelligenceData> {
  const [surface, riskSurface, agencySettings, intelligence, signals, interventions] = await Promise.all([
    db.from("ai_surface_settings").select("enabled, mode").eq("agency_id", agencyId).eq("surface", INBOX_TRIAGE_SURFACE_CODE).maybeSingle(),
    db.from("ai_surface_settings").select("enabled, mode").eq("agency_id", agencyId).eq("surface", INBOX_RISK_SURFACE_CODE).maybeSingle(),
    db.from("agency_settings").select("offer_snapshot_max_age_minutes").eq("agency_id", agencyId).maybeSingle(),
    loadIntelligence(db, agencyId, conversationId),
    listLiveSignals(db, agencyId, conversationId),
    listInterventions(db, agencyId, conversationId, { openOnly: true }),
  ]);
  if (surface.error) throw new Error(`Could not read the triage setting: ${surface.error.message}`);
  if (riskSurface.error) throw new Error(`Could not read the risk setting: ${riskSurface.error.message}`);
  if (agencySettings.error) throw new Error(`Could not read the offer age limit: ${agencySettings.error.message}`);

  let sourceMessage: InboxIntelligenceData["sourceMessage"] = null;
  if (intelligence && (intelligence.state === "FRESH" || intelligence.state === "STALE")) {
    // The reading is of the newest customer message at or before it was computed.
    const { data, error } = await db
      .from("conversation_messages")
      .select("id, content, created_at")
      .eq("agency_id", agencyId)
      .eq("conversation_id", conversationId)
      .eq("actor_kind", "CUSTOMER")
      .lte("created_at", intelligence.computedAt)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`Could not read the source message: ${error.message}`);
    const row = (data ?? [])[0] as { id: string; content: string | null; created_at: string } | undefined;
    if (row) sourceMessage = { id: row.id, snippet: snippetOf(row.content ?? ""), createdAt: row.created_at };
  }

  // R1: an offer is only as good as the live group behind it. A failed read is reported as "could not check" (null),
  // never as fresh: the card then refuses to hand out figures.
  let offerCheck: InboxIntelligenceData["offerCheck"];
  if (intelligence?.matchedOffer) {
    try {
      offerCheck = await checkStoredOffer(db, agencyId, intelligence.matchedOffer, new Date().toISOString());
    } catch (cause) {
      console.error("Could not check the stored offer against the live group:", cause instanceof Error ? cause.message : cause);
      offerCheck = null;
    }
  }

  return {
    surfaceEnabled: Boolean(surface.data && surface.data.enabled && surface.data.mode !== "OFF"),
    riskVisible: Boolean(riskSurface.data && riskSurface.data.enabled && (riskSurface.data.mode === "PROPOSE" || riskSurface.data.mode === "ACTIVE")),
    offerAge: intelligence?.matchedOffer
      ? {
          minutes: Math.max(0, Math.round((Date.now() - Date.parse(intelligence.matchedOffer.asOf)) / 60_000)),
          limitMinutes: (agencySettings.data as { offer_snapshot_max_age_minutes: number | null } | null)?.offer_snapshot_max_age_minutes ?? DEFAULT_OFFER_MAX_AGE_MINUTES,
        }
      : null,
    intelligence,
    signals,
    interventions,
    sourceMessage,
    ...(offerCheck !== undefined ? { offerCheck } : {}),
  };
}
