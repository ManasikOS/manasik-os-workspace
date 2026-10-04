-- TASK-032 S1: mark an agency as a TEST agency so it can never contact a real provider.
--
-- The production go-live gate (TASK-032 W7) and the browser acceptance runs create a disposable `E2E-` agency, drive the Inbox through it and
-- delete it. That agency must never be able to message a real phone or account, whatever its data or connections look like. The application
-- refuses every provider send for an agency whose `is_test` is true (lib/inbox/outbound/test-agency-send-guard.ts); this migration adds the
-- flag and makes it tamper-proof.
--
-- Who may set it: only the service role (or a migration/SQL session). A signed-in user, including an ADMIN of the agency and a platform
-- admin acting through the app, cannot create an agency as a test agency and cannot change the flag on an existing one: either would let a
-- real agency silence its own sends, or let a test agency pretend to be real. The trigger below enforces that for the `authenticated` and
-- `anon` roles. Reading is unchanged: the column is visible to whoever can already read the agency row.
--
-- Safe to apply: additive, defaults to false for every existing agency, no data changes, no policy changes. Idempotent.
-- Rollback: `alter table public.agencies drop column is_test;` after dropping the trigger and function below (nothing else depends on them).

alter table public.agencies
  add column if not exists is_test boolean not null default false;

comment on column public.agencies.is_test is
  'True for a disposable test agency (acceptance runs, the production go-live gate). The application never sends to a real provider for such an agency. Settable only by the service role.';

create or replace function public.agencies_is_test_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Not security definer on purpose: current_user is the caller's role, which is what has to be checked.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.is_test then
      raise exception 'agencies.is_test can only be set by the service role' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.is_test is distinct from old.is_test then
      raise exception 'agencies.is_test can only be changed by the service role' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.agencies_is_test_guard() from public, anon, authenticated;

drop trigger if exists agencies_is_test_guard on public.agencies;
create trigger agencies_is_test_guard
  before insert or update of is_test on public.agencies
  for each row execute function public.agencies_is_test_guard();
