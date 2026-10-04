/**
 * Quotes proposal kinds — plan §4.4. Native v2, `module: "quotes"`,
 * `subjectType: "QUOTE"`, backed by `loadQuotePack()` (`../quote-pack.ts`).
 *
 * Each executor calls exactly one existing pure store mutator from
 * `lib/data/leads.ts` — the same load-whole-store/mutate/persist shape
 * `app/(main)/leads/actions.ts` and `app/(main)/quotes/[quoteId]/actions.ts`
 * use for a human-initiated version of the same change. None of these
 * finalises a decision, discounts, or reserves capacity — per plan §4.4
 * "Never: Confirm, discount, reserve capacity, create a booking → no tool."
 */

import { z } from "zod";

import {
  extendQuoteValidityInStore,
  createQuoteRevisionInStore,
  setFollowUpInStore,
} from "@/lib/data/leads";
import { loadLeadStore, persistLeadStore, snapshotLeadStore } from "@/lib/data/leads-repository";
import { loadQuotePack, type QuoteContextPack } from "@/lib/agent/kernel/proposals/quote-pack";
import type { ProposalExecutor } from "@/lib/agent/kernel/proposals/executor";

/* ── QUOTE_SEND_FOLLOW_UP ──────────────────────────────────────────────────── */
/**
 * "Consent-gated draft sent through the existing send path" (plan §4.4) —
 * no automated WhatsApp/email dispatch exists for quotes yet, so this
 * executor's real effect is scheduling the lead's own follow-up (the same
 * `SEND_QUOTE` follow-up type a human sets from the lead drawer), owned by
 * whoever approves it. The actual message is still a human conversation,
 * never sent by this executor.
 */
const SendFollowUpSchema = z.object({
  quoteId: z.string().uuid(),
  leadId: z.string().uuid(),
  quoteReference: z.string().min(1),
  nextFollowUpAt: z.string(),
});
type SendFollowUpPayload = z.infer<typeof SendFollowUpSchema>;

export const quoteSendFollowUpExecutor: ProposalExecutor<SendFollowUpPayload, QuoteContextPack> = {
  kind: "QUOTE_SEND_FOLLOW_UP",
  module: "quotes",
  subjectType: "QUOTE",
  schema: SendFollowUpSchema,
  requiredCapability: "sendQuote",
  risk: "HIGH",
  ttlHours: 48,
  loadPack: loadQuotePack,
  fingerprint: (p) => `QUOTE_SEND_FOLLOW_UP:${p.quoteId}`,
  dependencySnapshot: (_p, pack) => ({ status: pack.facts.status, validUntil: pack.facts.validUntil }),
  describe: (p) => ({ humanDiff: [{ field: "next follow-up", from: null, to: p.nextFollowUpAt }] }),
  execute: async (p, ctx) => {
    const store = await loadLeadStore(ctx.db);
    const before = snapshotLeadStore(store);
    const outcome = setFollowUpInStore(
      store,
      {
        leadId: p.leadId,
        actorName: ctx.actor.name,
        nextFollowUpAt: p.nextFollowUpAt,
        followUpType: "SEND_QUOTE",
        followUpOwnerId: ctx.actor.id ?? "",
        followUpOwnerName: ctx.actor.name,
      },
      new Date().toISOString(),
    );
    if (!outcome.ok) return { ok: false, error: outcome.error ?? "Could not schedule the follow-up." };
    await persistLeadStore(ctx.db, before, store);
    return { ok: true };
  },
};

/* ── QUOTE_REVISION_DRAFTED ───────────────────────────────────────────────── */

const RevisionDraftedSchema = z.object({ quoteId: z.string().uuid() });
type RevisionDraftedPayload = z.infer<typeof RevisionDraftedSchema>;

/**
 * Clones the quote into a new DRAFT — `createQuoteRevisionInStore` copies
 * every price field verbatim, so this can never diverge from whatever the
 * pricing engine already produced (plan §4.4: "prices come from the pricing
 * engine, never the model").
 */
export const quoteRevisionDraftedExecutor: ProposalExecutor<RevisionDraftedPayload, QuoteContextPack> = {
  kind: "QUOTE_REVISION_DRAFTED",
  module: "quotes",
  subjectType: "QUOTE",
  schema: RevisionDraftedSchema,
  requiredCapability: "createQuote",
  risk: "LOW",
  ttlHours: 72,
  loadPack: loadQuotePack,
  fingerprint: (p) => `QUOTE_REVISION_DRAFTED:${p.quoteId}`,
  dependencySnapshot: (_p, pack) => ({ status: pack.facts.status }),
  describe: () => ({ humanDiff: [{ field: "revision", from: null, to: "new DRAFT" }] }),
  execute: async (p, ctx) => {
    const store = await loadLeadStore(ctx.db);
    const before = snapshotLeadStore(store);
    const outcome = createQuoteRevisionInStore(store, { sourceQuoteId: p.quoteId, actorName: ctx.actor.name }, new Date().toISOString());
    if (!outcome.ok) return { ok: false, error: outcome.error ?? "Could not draft a revision." };
    await persistLeadStore(ctx.db, before, store);
    return { ok: true };
  },
};

/* ── QUOTE_EXTEND_VALIDITY ────────────────────────────────────────────────── */

const ExtendValiditySchema = z.object({
  quoteId: z.string().uuid(),
  days: z.number().int().min(1).max(30),
});
type ExtendValidityPayload = z.infer<typeof ExtendValiditySchema>;

/**
 * "Only while seats and price are unchanged" (plan §4.4) — the dependency
 * snapshot pins the quote's total; a re-priced or re-sold-out quote makes
 * this stale before a human even sees it. This pack has no seats concept
 * (a quote isn't itself a hold), so price is the only pin available here.
 */
export const quoteExtendValidityExecutor: ProposalExecutor<ExtendValidityPayload, QuoteContextPack> = {
  kind: "QUOTE_EXTEND_VALIDITY",
  module: "quotes",
  subjectType: "QUOTE",
  schema: ExtendValiditySchema,
  requiredCapability: "sendQuote",
  risk: "MEDIUM",
  ttlHours: 48,
  loadPack: loadQuotePack,
  fingerprint: (p) => `QUOTE_EXTEND_VALIDITY:${p.quoteId}`,
  dependencySnapshot: (_p, pack) => ({ totalLkr: pack.facts.totalLkr, status: pack.facts.status }),
  describe: (p) => ({ humanDiff: [{ field: "extend by", from: null, to: `${p.days} day(s)` }] }),
  execute: async (p, ctx) => {
    const store = await loadLeadStore(ctx.db);
    const before = snapshotLeadStore(store);
    const outcome = extendQuoteValidityInStore(store, { quoteId: p.quoteId, days: p.days, actorName: ctx.actor.name }, new Date().toISOString());
    if (!outcome.ok) return { ok: false, error: outcome.error ?? "Could not extend validity." };
    await persistLeadStore(ctx.db, before, store);
    return { ok: true };
  },
};
