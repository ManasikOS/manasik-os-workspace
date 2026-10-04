-- ─────────────────────────────────────────────────────────────────────────────
-- Announcements: real WhatsApp dispatch.
--
-- 20261017090000_announcements.sql deliberately left channel dispatch
-- unbuilt because no outbound broadcast integration existed yet. It does
-- now — the WhatsApp Cloud API client (lib/whatsapp/client.ts) and
-- whatsapp_integrations/whatsapp_templates already power the Inbox's
-- per-conversation send path. This migration wires the WHATSAPP channel to
-- that same integration.
--
-- Broadcast recipients are essentially never inside the 24-hour service
-- window (that's what "outside a live conversation" means), so Meta only
-- allows an approved template message here — never free text. A WHATSAPP
-- announcement must therefore reference one specific approved
-- whatsapp_templates row rather than sending its own `body` as a raw
-- message. whatsapp_template_param carries the one body-variable value
-- ({{1}}) when the chosen template has one; templates with zero or more
-- than one variable are the two cases lib/whatsapp/template-params.ts and
-- the compose UI both handle explicitly.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.announcements
  add column if not exists whatsapp_template_id uuid references public.whatsapp_templates (id) on delete set null;
alter table public.announcements
  add column if not exists whatsapp_template_param text;

alter table public.announcements drop constraint if exists announcements_whatsapp_template_check;
alter table public.announcements add constraint announcements_whatsapp_template_check
  check (channel <> 'WHATSAPP' or whatsapp_template_id is not null);

-- ─────────────────────────────────────────────────────────────────────────────
-- announcement_recipients.delivery_error — set when a WhatsApp send to a
-- contactable recipient was actually attempted and Meta rejected it
-- (dead token, number not on WhatsApp, etc). Distinct from
-- exclusion_reason, which means the recipient was never attempted at all
-- because consent excluded them before any send happened.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.announcement_recipients
  add column if not exists delivery_error text;

notify pgrst, 'reload schema';
