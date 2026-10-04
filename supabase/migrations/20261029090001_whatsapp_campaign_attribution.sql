-- Automatic campaign attribution capture for inbound WhatsApp click-to-chat
-- (docs/modules/campaigns-command-center-implementation-plan.md §9, "Automatic lead
-- creation from web forms / WhatsApp click-to-chat into campaign_touchpoints").
--
-- `campaign_touchpoints` (20261027090000) already exists but nothing writes
-- to it — attribution can only be captured on the FIRST inbound message of a
-- conversation, before a lead exists, because that is the only moment a
-- click-to-chat tracking code (campaign_assets.qr_code_value) is available in
-- the raw message text. These columns hold that capture on the conversation
-- row until the lead is created (lib/agent/whatsapp/tools/leads.ts), at which
-- point a FIRST touchpoint is written and these columns have done their job.
alter table public.conversations
  add column if not exists attributed_campaign_id uuid references public.campaigns (id) on delete set null,
  add column if not exists attribution_channel text,
  add column if not exists attribution_tracking_code text,
  add column if not exists attribution_source_detail text,
  add column if not exists attribution_confidence text
    check (attribution_confidence is null or attribution_confidence in ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
  add column if not exists attribution_captured_at timestamptz;

comment on column public.conversations.attributed_campaign_id is
  'Resolved from a click-to-chat tracking code/QR in the opening inbound message, captured before any lead exists. Written once (first match wins) — see resolveCampaignAttributionFromMessageText in lib/whatsapp/campaign-attribution.ts.';

create index if not exists conversations_attributed_campaign_idx
  on public.conversations (attributed_campaign_id) where attributed_campaign_id is not null;

notify pgrst, 'reload schema';
