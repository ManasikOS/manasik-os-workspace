-- All AI now runs through OpenRouter under OpenRouter model slugs (lib/ai/provider.ts), and the default
-- models changed to cheap ones. ai_model_rates matches the model string recorded on each agent run, so
-- without these rows every new run would be unpriced and the AI-cost figure would read $0 again
-- (the same gap 20261124090000_ai_model_rate_opus_5.sql fixed for opus).
--
-- OpenRouter list prices per million tokens as read on 2026-09-19. Add a NEW dated row when a price
-- changes rather than editing one, so past runs keep the rate they were billed under.
--
-- Data only: ai_model_rates is platform-global, readable by all, writable by service_role, and already
-- carries its RLS from 20260926090000_whatsapp_billing.sql.

insert into public.ai_model_rates
  (model, effective_from, input_rate_per_million, output_rate_per_million,
   cache_read_rate_per_million, cache_write_rate_per_million, currency)
values
  ('openai/gpt-5.6-luna',              '2026-01-01', 0.1000, 0.6000, 0.0100, 0.1250, 'USD'),
  ('google/gemini-3.8-flash',          '2026-01-01', 0.3750, 1.8750, 0.0375, 0.0208, 'USD'),
  ('deepseek/deepseek-v4-flash-0731',  '2026-01-01', 0.0600, 0.1200, 0.0000, 0.0000, 'USD'),
  ('anthropic/claude-opus-5',          '2026-01-01', 5.0000, 25.0000, 0.5000, 6.2500, 'USD')
on conflict (model, effective_from) do nothing;
