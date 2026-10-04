alter table public.agency_email_delivery_profiles
  add column sender_identity_state text not null default 'UNVERIFIED' check (sender_identity_state in ('UNVERIFIED', 'VERIFIED')),
  add column verified_sender_email text,
  add column sender_verification_token_hash text,
  add column sender_verification_expires_at timestamptz,
  add column sender_verification_used_at timestamptz;
alter table public.agency_email_delivery_profiles add constraint agency_email_delivery_profiles_sender_verification_check check ((sender_identity_state = 'VERIFIED' and verified_sender_email is not null) or sender_identity_state = 'UNVERIFIED');
