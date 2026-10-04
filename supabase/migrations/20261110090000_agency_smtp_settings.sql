-- SMTP configuration is agency-scoped; passwords are encrypted in Vault.
create table if not exists public.agency_smtp_settings (
  agency_id uuid primary key references public.agencies(id),
  host text not null,
  port integer not null check (port between 1 and 65535),
  security text not null check (security in ('STARTTLS', 'TLS')),
  username text not null,
  password_ref uuid not null,
  from_name text not null default '',
  from_email text not null,
  reply_to text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.agency_smtp_settings enable row level security;
-- Access is exclusively through authorized server actions.
revoke all on public.agency_smtp_settings from anon, authenticated;
grant all on public.agency_smtp_settings to service_role;

create or replace function public.save_agency_smtp_settings(p_agency_id uuid, p_config jsonb, p_password text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ref uuid;
begin
  -- Serializes password replacement and settings writes for one agency.
  perform pg_advisory_xact_lock(hashtextextended(p_agency_id::text, 0));
  select password_ref into v_ref from public.agency_smtp_settings where agency_id = p_agency_id;
  if p_password is not null and length(p_password) > 0 then
    if v_ref is null then
      v_ref := vault.create_secret(p_password, 'smtp_' || p_agency_id::text || '_' || gen_random_uuid()::text);
    else
      perform vault.update_secret(v_ref, p_password);
    end if;
  end if;
  if v_ref is null then raise exception 'An SMTP password is required.'; end if;
  insert into public.agency_smtp_settings
    (agency_id, host, port, security, username, password_ref, from_name, from_email, reply_to)
  values (p_agency_id, p_config->>'host', (p_config->>'port')::integer, p_config->>'security',
    p_config->>'username', v_ref, p_config->>'fromName', p_config->>'fromEmail', p_config->>'replyTo')
  on conflict (agency_id) do update set host = excluded.host, port = excluded.port,
    security = excluded.security, username = excluded.username, password_ref = excluded.password_ref,
    from_name = excluded.from_name, from_email = excluded.from_email, reply_to = excluded.reply_to, updated_at = now();
end;
$$;
revoke all on function public.save_agency_smtp_settings(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.save_agency_smtp_settings(uuid,jsonb,text) to service_role;
