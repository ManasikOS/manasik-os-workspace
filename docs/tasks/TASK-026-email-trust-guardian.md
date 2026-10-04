# TASK-026 Email Trust Guardian

## What

Plan and deliver an agency-scoped Email Trust Guardian for the Inbox. It guides
custom SMTP + IMAP setup, verifies the sender and domain health, protects
person-to-person sends from avoidable delivery risks, and explains what staff
can do next in plain language.

The lasting, slice-by-slice plan is
[`../inbox/email-trust-guardian-implementation-plan.md`](../inbox/email-trust-guardian-implementation-plan.md).

## Why

An agency can save valid Hostinger (or another provider's) credentials and
still send mail that lands in spam. SMTP acceptance, DNS authentication,
sender alignment, recipient quality, and provider reputation are different
problems. Non-technical users need the CRM to distinguish them and prevent
the avoidable failures without promising Inbox placement.

## Data model changes

Planned, additive, agency-scoped records for the delivery profile, domain-check
history, atomic dispatch quota, and hashed recipient suppressions. Existing
`message_delivery_events` will gain a precise compatible bounce/failure
classification. Each new public-schema table gets RLS, indexes, grants, and
two-agency isolation proof in the same migration. SMTP/IMAP credentials remain
in the existing Vault-backed `agency_smtp_settings` path.

## Access control changes

Setup and health mutations use the existing settings integration capability;
Email sending keeps the existing Inbox send capability. Every action requires
an authenticated user, Zod validation, and agency-scoped access. Workers may
process only queued, agency-bound work. No raw credentials, secret references,
SMTP transcripts, recipient addresses in suppressions, or message bodies are
returned by the health APIs.

## UI surfaces

- `Settings → Email`: provider preset, guided checks, sender verification,
  DNS results, health status, and next actions.
- Inbox Email compose: current readiness, warning acknowledgement, and clear
  block/temporary-limit feedback.
- Optional staff suppression restore and delivery-status context.

## Test plan

Cover provider field validation, SMTP/IMAP result mapping, sender-token expiry
and replay, SPF/DKIM/DMARC result states, cross-tenant isolation, dispatch
policy/rate-limit races, idempotent retries, permanent versus temporary bounces,
suppression restore, and redaction. Complete real-mailbox browser verification
for Hostinger and one other provider before rollout, plus an intentional bounce
test where allowed.

## Status

In progress — TG0 is being implemented on `fixing-existing-things` with the
requester's explicit acceptance that EM3–EM5 remain incomplete prerequisites.
TG0 does not wire persistence, credential handling, or UI; those are owned by
the later Trust Guardian slices and the existing Email channel plan.

