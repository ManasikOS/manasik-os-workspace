-- SC3 (docs/inbox/scaling.md §6.3): advance `conversations.version` on every VISIBLE mutation.
--
-- The column has existed since the unified-inbox migration but nothing advanced it, so it could not order anything. The
-- browser needs it for one rule: "a list patch older than the version I hold cannot overwrite newer state". It is the
-- list/header ordering counter only — message order is `conversation_messages.sequence_number`, a separate counter.
--
-- "Visible" means any column except:
--   * `version` itself and `updated_at` (bookkeeping the trigger or `set_updated_at` writes);
--   * `composing_by` / `composing_at` (the composer lease heartbeat — presence, not list content; it is announced on the
--     conversation topic by SC5 and must not make every list row look changed).
-- A statement that changes only those columns leaves the version alone.
create or replace function public.advance_conversation_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['version', 'updated_at', 'composing_by', 'composing_at'])
     is distinct from
     (to_jsonb(old) - array['version', 'updated_at', 'composing_by', 'composing_at']) then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.advance_conversation_version() from public, anon, authenticated;

drop trigger if exists conversations_advance_version on public.conversations;
create trigger conversations_advance_version
  before update on public.conversations
  for each row execute function public.advance_conversation_version();
