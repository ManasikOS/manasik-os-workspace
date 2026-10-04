# TASK-025 Email Inbox Channel

## What
Add Email (generic SMTP+IMAP, provider code `GMAIL`) as a Gmail-like channel in the
Unified Inbox: read incoming mail, thread it against a contact, reply/compose with
Cc/Bcc and a subject, attachments both ways, and search — reusing the agency's existing
outbound-only SMTP settings.

## Why
The agency already sends transactional email via a working SMTP integration
(`app/(main)/management/settings/email/`) but has no way to see or reply to email inside
the CRM. The request is to make the Inbox handle email the way staff already handle
WhatsApp/Instagram/Messenger there.

This is a new channel, not a discrete fix, so its full design lives with the Inbox +
Copilot programme per `AGENTS.md`, not inline in this file:

**See [`../inbox/email-channel-implementation-plan.md`](../inbox/email-channel-implementation-plan.md)
for the plan, and [`../inbox/checklist.md`](../inbox/checklist.md#email-channel-track)
(the "Email channel track", slices EM0–EM5) for live build progress.**

## Data model changes
See the plan's Phase 0 — `agency_smtp_settings` gains IMAP columns, a `channel_connections`
row bridges to it, and a new dedupe constraint is added on `conversation_messages`.

## Access control changes
None beyond the existing agency-scoped SMTP settings capability
(`capabilitiesForSettings().editIntegrations`); the email channel is gated by
`resolveInboxFeatureAvailability` as a Professional-tier surface (plan Phase 5).

## UI surfaces
`app/(main)/management/settings/email/` (IMAP fields), `app/inbox/components/message-composer.tsx`,
`app/inbox/components/conversation-panel.tsx`, a new "Compose email" entry point.

## Test plan
See the plan's Phase 5 and Verification plan — automated coverage for cursor idempotency,
identity matching, error classification and HTML sanitization; manual browser
verification of the full send/receive/thread/attach/search golden path against a real
test mailbox.

## Status
In progress — Phases 0–2 (EM0: schema + connection bridge, EM1: `gmailChannelAdapter`, EM2:
inbound IMAP poll + cron) built and applied to Manasik OS, all 2026-09-28. Phases 3–5
(EM3–EM5) not started. Update this line and the "Email channel track" checklist as slices
land.
