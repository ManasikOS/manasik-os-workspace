-- FIX9: `plans.features` is the one product-entitlement contract for optional Inbox surfaces.
-- Surface on/off, mode, and autonomy remain solely in ai_surface_settings.

update public.plans
set features = case code
  when 'STARTER' then '{"payment_claim_risk":true}'::jsonb
  when 'GROWTH' then '{"offer_matching":true,"identity_resolution":true,"sla":true,"media_intelligence":true,"owner_panel":"read_only"}'::jsonb
  when 'PROFESSIONAL' then '{"offer_matching":true,"identity_resolution":true,"sla":true,"media_intelligence":true,"answer_cache":true,"owner_panel":true,"audit_export":true}'::jsonb
  when 'ENTERPRISE' then '{"all":true}'::jsonb
  else features
end
where code in ('STARTER', 'GROWTH', 'PROFESSIONAL', 'ENTERPRISE');
