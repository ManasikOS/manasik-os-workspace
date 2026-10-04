-- The WhatsApp agent runs on claude-opus-5 (lib/ai/provider.ts) but ai_model_rates only priced
-- claude-sonnet-5, so every agent run was unpriced and the AI-cost figure read $0.
--
-- Anthropic list prices per million tokens, as of 2026-06-24: input 5, output 25. Cache read is
-- 0.1x input and 5-minute cache write is 1.25x input (Anthropic's standard multipliers; the agent
-- uses the default 5-minute ephemeral cache). Re-check these when Anthropic changes pricing and add
-- a NEW dated row rather than editing this one, so past runs keep pricing at the rate they were
-- billed under.
--
-- Data only: ai_model_rates is platform-global, readable by all, writable by service_role, and
-- already carries its RLS from 20260926090000_whatsapp_billing.sql.

insert into public.ai_model_rates
  (model, effective_from, input_rate_per_million, output_rate_per_million,
   cache_read_rate_per_million, cache_write_rate_per_million, currency)
values
  ('claude-opus-5', '2026-01-01', 5.0000, 25.0000, 0.5000, 6.2500, 'USD')
on conflict (model, effective_from) do nothing;
