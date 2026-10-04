-- Email channel foundation (Phase 0 of docs/inbox/email-channel-implementation-plan.md).
--
-- Additive only. Adds IMAP fields to the existing agency SMTP settings (the same mailbox
-- credentials serve both protocols, per the plan's D3) and bridges that settings row to a
-- `channel_connections` row so the existing outbound outbox drain (whose `connection_id` is a
-- hard FK to `channel_connections`) can address it, exactly as WhatsApp does via
-- `legacy_whatsapp_integration_id`. No dedupe constraint is added for inbound email idempotency:
-- `conversation_messages_external_id_unique` (agency_id, external_message_id) already exists
-- (migration 20260825090000) and is provider-neutral, so email ingestion (Phase 2) reuses it by
-- storing the RFC 5322 Message-ID as `external_message_id`.

alter table public.agency_smtp_settings
  add column if not exists imap_host text,
  add column if not exists imap_port integer check (imap_port between 1 and 65535),
  add column if not exists imap_security text check (imap_security in ('STARTTLS', 'TLS'));

comment on column public.agency_smtp_settings.imap_host is
  'Inbound mailbox host. Null means SMTP is configured but inbound polling is not enabled yet. Reuses the SMTP username/password_ref (the same mailbox credentials serve both protocols for every mainstream provider).';

-- One GMAIL channel_connections row per agency, matching agency_smtp_settings' own one-row-per-agency
-- shape (its primary key is agency_id alone) — distinct from the Meta providers' global
-- (provider, provider_account_id) tenant gate, which does not apply here.
create unique index if not exists channel_connections_gmail_agency_unique
  on public.channel_connections (agency_id, provider)
  where provider = 'GMAIL';

create or replace function public.save_agency_smtp_settings(p_agency_id uuid, p_config jsonb, p_password text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ref uuid;
  v_imap_host text := nullif(btrim(p_config->>'imapHost'), '');
  v_imap_port integer := (p_config->>'imapPort')::integer;
  v_imap_security text := p_config->>'imapSecurity';
  v_connection_status text;
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
    (agency_id, host, port, security, username, password_ref, from_name, from_email, reply_to,
     imap_host, imap_port, imap_security)
  values (p_agency_id, p_config->>'host', (p_config->>'port')::integer, p_config->>'security',
    p_config->>'username', v_ref, p_config->>'fromName', p_config->>'fromEmail', p_config->>'replyTo',
    v_imap_host, v_imap_port, v_imap_security)
  on conflict (agency_id) do update set host = excluded.host, port = excluded.port,
    security = excluded.security, username = excluded.username, password_ref = excluded.password_ref,
    from_name = excluded.from_name, from_email = excluded.from_email, reply_to = excluded.reply_to,
    imap_host = excluded.imap_host, imap_port = excluded.imap_port, imap_security = excluded.imap_security,
    updated_at = now();

  -- The Inbox outbox drain only sends through a CONNECTED connection: an agency that has saved SMTP
  -- but not IMAP can still send (Phase 1), but the Inbox has nothing to poll for it yet (Phase 2), so
  -- the connection is not marked connected until an inbound mailbox is configured.
  v_connection_status := case when v_imap_host is not null then 'CONNECTED' else 'NOT_CONNECTED' end;

  insert into public.channel_connections
    (agency_id, provider, provider_account_id, display_name, status, credential_ref, provider_metadata)
  values (
    p_agency_id, 'GMAIL', p_config->>'fromEmail', coalesce(nullif(p_config->>'fromName', ''), p_config->>'fromEmail'),
    v_connection_status, v_ref::text,
    jsonb_build_object(
      'host', p_config->>'host', 'port', (p_config->>'port')::integer, 'security', p_config->>'security',
      'username', p_config->>'username', 'fromName', p_config->>'fromName', 'fromEmail', p_config->>'fromEmail',
      'replyTo', p_config->>'replyTo', 'imapHost', v_imap_host, 'imapPort', v_imap_port, 'imapSecurity', v_imap_security
    )
  )
  on conflict (agency_id, provider) where provider = 'GMAIL'
  do update set
    provider_account_id = excluded.provider_account_id, display_name = excluded.display_name,
    status = excluded.status, credential_ref = excluded.credential_ref,
    provider_metadata = excluded.provider_metadata, updated_at = now();
end;
$$;
revoke all on function public.save_agency_smtp_settings(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.save_agency_smtp_settings(uuid,jsonb,text) to service_role;
