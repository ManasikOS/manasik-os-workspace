alter table public.message_delivery_events add column if not exists email_delivery_status text check (email_delivery_status in ('SENT','TEMPORARY_FAILURE','PERMANENT_BOUNCE','UNKNOWN','AUTO_REPLY'));
create index if not exists message_delivery_events_email_status_idx on public.message_delivery_events (agency_id, email_delivery_status, created_at desc) where email_delivery_status is not null;
