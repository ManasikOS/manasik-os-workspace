# FIX13 browser and provider acceptance — preflight snapshot

**Date:** 2026-09-23  
**Environment:** not selected  
**Status:** blocked before acceptance execution

FIX13 requires a signed-in non-production environment, named test contacts,
and non-production document/payment fixtures. None were available at this
snapshot: no browser session or local development server was active, and no
test agency, provider contact, or fixture identifier was supplied. No provider
message, upload, data mutation, or production read was attempted.

## Required evidence log

| Scenario | Environment / fixture ID | Observed result | Evidence |
|---|---|---|---|
| Responsive Inbox rail: desktop, tablet, mobile | Pending | Not run | Screenshots at all three widths |
| Composer presence in two signed-in browsers | Pending | Not run | Both session screenshots |
| Intent, offer, evidence and identity cards | Pending | Not run | Screenshots and source conversation IDs |
| Quote, booking, conversion actions and Operations handoff | Pending | Not run | Created record IDs and handoff acknowledgement |
| WhatsApp window boundary and approved-template rate | Pending | Not run | Delivery state plus provider bill/rate comparison |
| Messenger/Instagram HUMAN_AGENT boundaries | Pending | Not run | Delivery/refusal audit rows |
| Voice, passport, receipt, promotion and signed links | Pending | Not run | Five-minute link check and review IDs |
| L0 → L1 → L2 promotion/demotion | Pending | Not run | Autonomy audit row IDs |
| Owner metric drill-through and two-currency presentation | Pending | Not run | Queue reconciliation screenshots |
| Allowance: 80%, 100%, 120%, 200% | Pending | Not run | Usage counter and visible reason |
| Retention dry-run/live reconciliation | Pending | Not run | Sweep IDs, counts and Storage ordering evidence |

## Preflight prerequisites

1. A non-production agency with Inbox migration set through `20261202093700`.
2. Signed-in staff sessions for two eligible test users, with the necessary
   Inbox, Operations, Finance, Documents and AI-management capabilities.
3. Explicitly identified test-only WhatsApp, Messenger and/or Instagram
   contacts. Provider sends will be confirmed immediately before dispatch.
4. Test-only voice, passport and receipt files; no customer PII or production
   financial/document data.
5. Provider billing/rate source available to compare the approved-template
   projected charge.

This is a point-in-time record, not acceptance evidence. Update it only by
adding a later snapshot after scenarios are actually observed.
