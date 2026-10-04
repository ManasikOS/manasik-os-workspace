alter table public.agency_settings
  add column if not exists booking_linked_message_retention_years integer not null default 7 check (booking_linked_message_retention_years between 3 and 10),
  add column if not exists enquiry_message_retention_months integer not null default 24 check (enquiry_message_retention_months between 1 and 120),
  add column if not exists inbox_attachment_retention_days integer not null default 90 check (inbox_attachment_retention_days between 1 and 365),
  add column if not exists voice_audio_retention_days integer not null default 180 check (voice_audio_retention_days between 1 and 365),
  add column if not exists intelligence_retention_months integer not null default 24 check (intelligence_retention_months between 1 and 120),
  add column if not exists ai_run_retention_months integer not null default 13 check (ai_run_retention_months between 1 and 60),
  add column if not exists webhook_payload_retention_days integer not null default 30 check (webhook_payload_retention_days between 1 and 90);

alter table public.message_attachments
  add column if not exists promoted_document_id uuid,
  add column if not exists expires_at timestamptz;

create table public.inbox_retention_sweeps (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  ran_at timestamptz not null default now(),
  scope text not null,
  cursor text,
  rows_deleted integer not null default 0 check (rows_deleted >= 0),
  objects_deleted integer not null default 0 check (objects_deleted >= 0),
  dry_run boolean not null default true,
  error text
);
create index inbox_retention_sweeps_agency_ran_idx on public.inbox_retention_sweeps(agency_id,ran_at desc);
alter table public.inbox_retention_sweeps enable row level security;
revoke all on public.inbox_retention_sweeps from anon, authenticated;
grant select on public.inbox_retention_sweeps to authenticated;
create policy inbox_retention_sweeps_select on public.inbox_retention_sweeps
  for select to authenticated
  using (agency_id=(select public.current_agency_id()) and public.staff_role_in('ADMIN','CEO'));

create or replace function public.invoke_cron_route(p_path text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_base_url text; v_secret text; v_request_id bigint;
begin
  if p_path not in ('/api/cron/agent-jobs','/api/cron/whatsapp-health','/api/cron/whatsapp-billing-sync','/api/cron/departure-ops-jobs','/api/cron/release-seat-holds','/api/cron/lead-followups','/api/cron/ai-usage-rollup','/api/cron/inbox-lanes','/api/cron/inbox-sla','/api/cron/inbox-retention') then
    raise exception 'invoke_cron_route: % is not a recognised cron path', p_path;
  end if;
  select ds.decrypted_secret into v_base_url from vault.decrypted_secrets ds join vault.secrets s on s.id=ds.id where s.name='cron_http_base_url';
  select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds join vault.secrets s on s.id=ds.id where s.name='cron_http_secret';
  if v_base_url is null or v_secret is null then return null; end if;
  select net.http_get(url:=v_base_url||p_path,headers:=jsonb_build_object('Authorization','Bearer '||v_secret),timeout_milliseconds:=55000) into v_request_id;
  return v_request_id;
end;
$$;
revoke execute on function public.invoke_cron_route(text) from public, anon, authenticated;

do $$ begin
  begin perform cron.unschedule('inbox-retention'); exception when others then null; end;
  perform cron.schedule('inbox-retention','17 2 * * *',format('select public.invoke_cron_route(%L);','/api/cron/inbox-retention'));
end $$;

notify pgrst, 'reload schema';
