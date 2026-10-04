-- MI4.6b — the second set of conversions (pilgrim profile, traveller relationship, package recommendation) also point back at their
-- conversation. Same columns and rules as 20261202092000_mi4_6_conversation_source_links.sql, applied to three more tables:
--
--   pilgrims                        a traveller profile created from a chat
--   booking_traveller_relationships a family / mahram link recorded from a chat
--   lead_notes                      a package recommendation recorded on the lead
--
-- Additive and idempotent. A separate migration (not an edit of the first) so it is safe whether or not the first was applied.

do $$
declare
  t text;
begin
  foreach t in array array['pilgrims', 'booking_traveller_relationships', 'lead_notes']
  loop
    execute format('alter table public.%I add column if not exists source_conversation_id uuid', t);
    execute format('alter table public.%I add column if not exists source_message_id uuid', t);

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_source_pair_check');
    execute format(
      'alter table public.%I add constraint %I check (source_message_id is null or source_conversation_id is not null)',
      t, t || '_source_pair_check');

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_source_conversation_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (source_conversation_id, agency_id) references public.conversations (id, agency_id) on delete set null (source_conversation_id)',
      t, t || '_source_conversation_fkey');

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_source_message_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (source_message_id, agency_id) references public.conversation_messages (id, agency_id) on delete set null (source_message_id)',
      t, t || '_source_message_fkey');

    execute format(
      'create index if not exists %I on public.%I (agency_id, source_conversation_id) where source_conversation_id is not null',
      t || '_source_conversation_idx', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Roll back:
--   do $$ declare t text; begin
--     foreach t in array array['pilgrims','booking_traveller_relationships','lead_notes'] loop
--       execute format('alter table public.%I drop column if exists source_message_id, drop column if exists source_conversation_id', t);
--     end loop; end $$;
