-- `note_mentions` references auth.users directly, so a foreign key alone
-- cannot prove that a mentioned staff member belongs to the note's agency.
-- Keep the defence in the database as well as in the Server Action.
create or replace function public.assert_note_mention_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_note_agency_id uuid;
begin
  select agency_id into v_note_agency_id
  from public.conversation_notes
  where id = new.note_id;

  if v_note_agency_id is null or v_note_agency_id <> new.agency_id then
    raise exception 'note mention must belong to the same agency as its note';
  end if;
  if not exists (
    select 1 from public.staff_profiles profile
    where profile.id = new.mentioned_user_id
      and profile.agency_id = new.agency_id
      and profile.status = 'ACTIVE'
  ) then
    raise exception 'mentioned staff member must be active in the note agency';
  end if;
  return new;
end;
$$;

drop trigger if exists note_mentions_assert_tenant on public.note_mentions;
create trigger note_mentions_assert_tenant
  before insert or update of agency_id, note_id, mentioned_user_id on public.note_mentions
  for each row execute function public.assert_note_mention_tenant();
