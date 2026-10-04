"use server";

import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { loadInboxOutcomeCardsForRole } from "@/lib/data/inbox-commercial-repository";
import type { InboxOutcomeCard } from "@/lib/metrics/inbox-outcome-cards";
import { createAdminClient } from "@/utils/supabase/admin";

export type LoadInboxOutcomeCardsResult =
  | { ok: true; cards: InboxOutcomeCard[]; unreadableSources: number; generatedAt: string }
  | { ok: false; error: string };

/**
 * The outcome cards this person's role may see. The agency and the role come from the signed-in session, never from the
 * request, and the role filter runs before anything is sent back.
 */
export async function loadInboxOutcomeCardsAction(): Promise<LoadInboxOutcomeCardsResult> {
  await requireUser();
  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };
  if (!capabilitiesForInbox(role).viewModule) return { ok: false, error: "Not permitted." };

  try {
    const now = new Date();
    const { cards, failures } = await loadInboxOutcomeCardsForRole(createAdminClient(), agencyId, role, { now });
    return { ok: true, cards, unreadableSources: failures.length, generatedAt: now.toISOString() };
  } catch (cause) {
    console.error("loadInboxOutcomeCardsAction failed:", cause instanceof Error ? cause.name : "unknown");
    return { ok: false, error: "The outcomes could not be loaded. Try again." };
  }
}
