# Inbox + Copilot traceability

Generated evidence index for FIX12. Unit-test and target-schema evidence are current; browser acceptance remains deliberately unclaimed until FIX13–FIX14.

| ID | Code | Named passing test | Live evidence / completing slice |
|---|---|---|---|
| G1 | `lib/inbox/intelligence/pipeline.ts` | `pipeline.test.ts` — G1 projection | FIX12 schema query; FIX13 UI |
| G2 | `lib/inbox/views.ts` | `views.test.ts` — G2 queues | FIX14 scale evidence |
| G3 | `lib/inbox/intelligence/offer.ts` | `offer.test.ts` — G3 offer matching | FIX13 |
| G4 | `lib/inbox/risk/registry.ts` | `registry.test.ts` — G4 risk registry | FIX13 shadow evidence |
| G5 | `lib/inbox/identity/graph.ts` | `graph.test.ts` — G5 identity graph | FIX13 |
| G6 | `lib/inbox/handoff/build.ts` | `build.test.ts` — G6 handoff | FIX13 |
| G7 | `lib/inbox/conversions/service.ts` | `service.test.ts` — G7 conversions | FIX13 |
| G8 | `lib/inbox/media/handlers.ts` | `handlers.test.ts` — G8 media | FIX13 |
| G9 | `lib/inbox/autonomy/` | `autonomy.test.ts` — G9 autonomy | FIX13 |
| G10 | `lib/inbox/owner-kpis.ts` | `owner-kpis.test.ts` — G10 owner KPIs | FIX13 |
| G11 | `lib/ai/telemetry.ts` | `lib/ai/usage-rollup.test.ts` — G11 ledger | FIX13 |
| G12 | `lib/inbox/jobs/` | `queue.test.ts` — G12 fairness | FIX14 |
| G13 | `lib/billing/entitlements.ts` | `entitlements.test.ts` — G13 plans | FIX13 |
| G14 | `lib/channels/policy-state.ts` | `policy-state.test.ts` — G14 HUMAN_AGENT | FIX13 |
| G15 | `lib/ai/surfaces/inbox/translation.ts` | `translation.test.ts` — G15 language state | FIX13 |
| R1 | `lib/inbox/intelligence/offer.ts` | `lib/inbox/risk/detectors/stale-price-quoted.test.ts` — R1 | FIX13 |
| R2 | `lib/inbox/sla/due-at.ts` | `due-at.test.ts` — R2 | `verify-mi2-6-sla.sql` |
| R3 | `lib/inbox/routing/resolve-owner.ts` | `resolve-owner.test.ts` — R3 | FIX13 |
| R4 | `lib/inbox/answers/eligibility.ts` | `cache.test.ts` — R4 | FIX13 |
| R5 | `lib/inbox/autonomy/promotion.ts` | `autonomy.test.ts` — R5 | FIX13 |
| R6 | `lib/inbox/pipeline-value.ts` | `pipeline-value.test.ts` — R6 | FIX13 |
| R7 | `lib/inbox/retention/policy.ts` | `policy.test.ts` — R7 | FIX13 |

Run `scripts/sql/verify-fix12-inbox-security.sql` in a rolled-back transaction after applying migrations. It checks the Inbox schema version set, RLS, invoker views, definer hardening, source-link composite keys, and relevant check constraints.

Target-schema evidence — 2026-09-23: the linked Manasik OS project reports all 38 Inbox programme migrations through `20261202093700` applied. The equivalent read-only catalog query returned no missing RLS, invoker-view, targeted-definer, source composite-FK, source-pair-check, or SLA-minute-check entries. The Supabase security advisor still reports project-wide, pre-existing findings; its Inbox rows are intentional locked-path tables/RPCs and remain subject to their capability and agency checks. This does not prove the WhatsApp optional-surfaces-disabled acceptance scenario.
