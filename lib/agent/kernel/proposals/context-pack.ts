/**
 * Context Packs — Phase 0 (P0.2), generalising `OpsSnapshot`
 * (`lib/agent/departure-ops/snapshot.ts`) to any subject type. See
 * docs/modules/manasik-intelligence-implementation-plan.md §3.3.
 *
 * A Context Pack is the *only* thing a model call is ever given: a
 * deterministic, evidence-linked, capability-redacted read model, built
 * fresh (never `React.cache()`-memoised — a worker may hydrate many
 * subjects in one invocation) from the same `lib/data/*` derivations a
 * human page already renders. Every executor's `loadPack()` returns one of
 * these; `dependencySnapshot()`/`describe()` read from `pack.facts`.
 *
 * `SubjectType` is deliberately a plain string union grown per phase, never
 * a closed enum tied to a DB check constraint — the same F5 lesson as
 * `agent_proposals.subject_type`/`module` in the companion migration.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type SubjectType =
  | "DEPARTURE_GROUP"
  | "BOOKING"
  | "QUOTE"
  | "INVOICE"
  | "REFUND_REQUEST"
  | "SUPPLIER"
  | "BANK_TRANSACTION"
  | "CONVERSATION"
  | "TEST_SUBJECT";

export interface EvidenceRef {
  label: string;
  entityType: string;
  entityId: string;
  href: string;
  module: string;
}

export interface ContextPack<TFacts = unknown> {
  subject: { type: SubjectType | string; id: string; label: string; href: string };
  generatedAt: string;
  /** Source table -> its most recent `updated_at`/`created_at` this pack read, so a viewer can see how fresh the pack is. */
  dataFreshness: Record<string, string>;
  facts: TFacts;
  evidenceIndex: EvidenceRef[];
  /** Field names removed from `facts` for this viewer's capabilities — so the model (and a viewer) can say "not visible to you" instead of silently omitting. */
  redactions: string[];
  /** `hashObject(facts)` — the NOOP gate and staleness fingerprint. */
  fingerprint: string;
}

export function buildContextPack<TFacts>(input: {
  subject: ContextPack["subject"];
  dataFreshness?: Record<string, string>;
  facts: TFacts;
  evidenceIndex?: EvidenceRef[];
  redactions?: string[];
  fingerprint: string;
}): ContextPack<TFacts> {
  return {
    subject: input.subject,
    generatedAt: new Date().toISOString(),
    dataFreshness: input.dataFreshness ?? {},
    facts: input.facts,
    evidenceIndex: input.evidenceIndex ?? [],
    redactions: input.redactions ?? [],
    fingerprint: input.fingerprint,
  };
}
