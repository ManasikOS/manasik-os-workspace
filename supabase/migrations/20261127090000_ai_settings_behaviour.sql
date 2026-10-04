-- Per-agency conversation style for the WhatsApp assistant: how long replies are, what a package
-- enquiry shows, which questions are asked and in what order, greeting and closing wording, and when a
-- person takes over. One JSON document so new options need no migration; its shape is validated by
-- lib/validations/ai-behaviour.ts on every write and read. An empty object means "use the defaults".
--
-- No new table and no new policy: ai_settings already has RLS (staff of the agency read, ADMIN writes).

alter table public.ai_settings
  add column if not exists behaviour jsonb not null default '{}'::jsonb;

comment on column public.ai_settings.behaviour is
  'Conversation style options for the WhatsApp assistant (see lib/validations/ai-behaviour.ts). {} = defaults.';
