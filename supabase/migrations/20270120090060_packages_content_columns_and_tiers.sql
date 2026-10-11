-- TASK-043 Phase 1, step 2 (change requests): the shared building blocks the publish function and the sensitive-change functions both use.
--
--   package_content_columns()          the one list of columns a publish or a change request may write. `status`, `featured`, ownership and every
--                                      lifecycle column are not in it.
--   package_field_tier(column)         0 = Basic (display text), 1 = Money & contract, 2 = Bookings & operations. An unlisted column is Tier 2 (fail safe).
--   package_itinerary_structure_changed(before, after)
--                                      the itinerary is Basic when only wording changes and Tier 2 when the days, their numbering or their categories change.
--   packages_apply_content(id, content)
--                                      the single place that writes content columns. Keys absent from `content` keep their value. Internal: callers have
--                                      already checked role, capability, agency and the row lock.
--
-- The same classification lives in lib/access/package-field-tiers.ts; lib/security/packages-change-requests-migration.test.ts fails if they differ.
-- Idempotent. Rollback: drop the four functions after re-applying the inline version of publish_package_with_content from 20270120090100.

create or replace function public.package_content_columns()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'title', 'internal_code', 'description', 'journey_type', 'category', 'package_category', 'branch', 'visibility',
    'default_capacity', 'min_group_size', 'waitlist_enabled', 'seat_hold_expiry', 'suggested_guide_ratio', 'max_pilgrims',
    'days', 'nights', 'duration',
    'payment_milestones', 'payment_terms', 'cancellation_policy', 'late_payment_policy', 'price_change_disclaimer', 'finance_role_view',
    'itinerary',
    'included_services',
    'makkah_accommodation_standard', 'makkah_customer_wording', 'makkah_nights', 'makkah_occupancies', 'makkah_target_distance',
    'makkah_meal_plan', 'makkah_exact_hotel_guarantee', 'makkah_hotel', 'makkah_exact_display_name',
    'madinah_accommodation_standard', 'madinah_customer_wording', 'madinah_nights', 'madinah_occupancies', 'madinah_target_distance',
    'madinah_meal_plan', 'madinah_exact_hotel_guarantee', 'madinah_hotel', 'madinah_exact_display_name',
    'transport_type', 'transport_requirements', 'inclusions', 'exclusions',
    'document_requirements', 'seat_reservation_rule', 'selected_communication_templates',
    'default_group_capacity', 'default_group_status', 'group_readiness_checklist'
  ]::text[]
$$;

create or replace function public.package_field_tier(p_column text)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case
    when p_column = any (array['payment_milestones', 'payment_terms', 'cancellation_policy', 'late_payment_policy', 'price_change_disclaimer']) then 1
    when p_column = any (array[
      'title', 'description', 'branch', 'package_category', 'duration', 'itinerary',
      'makkah_customer_wording', 'madinah_customer_wording',
      'makkah_hotel', 'madinah_hotel', 'makkah_exact_display_name', 'madinah_exact_display_name']) then 0
    else 2
  end::smallint
$$;

comment on function public.package_field_tier(text) is
  '0 Basic, 1 Money & contract, 2 Bookings & operations. Unlisted columns are Tier 2. `itinerary` is 0 here; package_itinerary_structure_changed raises it to 2 when the day structure changes.';

create or replace function public.package_itinerary_structure_changed(p_before jsonb, p_after jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    (select jsonb_agg(jsonb_build_array(e -> 'id', e -> 'dayNumber', e -> 'category') order by o)
       from jsonb_array_elements(case when jsonb_typeof(p_before) = 'array' then p_before else '[]'::jsonb end) with ordinality as t(e, o)),
    '[]'::jsonb)
  is distinct from
  coalesce(
    (select jsonb_agg(jsonb_build_array(e -> 'id', e -> 'dayNumber', e -> 'category') order by o)
       from jsonb_array_elements(case when jsonb_typeof(p_after) = 'array' then p_after else '[]'::jsonb end) with ordinality as t(e, o)),
    '[]'::jsonb)
$$;

create or replace function public.packages_apply_content(p_package_id uuid, p_content jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Keys absent from p_content keep their current value (jsonb_populate_record takes the row as its base).
  update public.packages p set
    title = r.title, internal_code = r.internal_code, description = r.description, journey_type = r.journey_type,
    category = r.category, package_category = r.package_category, branch = r.branch, visibility = r.visibility,
    default_capacity = r.default_capacity, min_group_size = r.min_group_size, waitlist_enabled = r.waitlist_enabled,
    seat_hold_expiry = r.seat_hold_expiry, suggested_guide_ratio = r.suggested_guide_ratio, max_pilgrims = r.max_pilgrims,
    days = r.days, nights = r.nights, duration = r.duration,
    payment_milestones = r.payment_milestones, payment_terms = r.payment_terms, cancellation_policy = r.cancellation_policy,
    late_payment_policy = r.late_payment_policy, price_change_disclaimer = r.price_change_disclaimer, finance_role_view = r.finance_role_view,
    itinerary = r.itinerary, included_services = r.included_services,
    makkah_accommodation_standard = r.makkah_accommodation_standard, makkah_customer_wording = r.makkah_customer_wording,
    makkah_nights = r.makkah_nights, makkah_occupancies = r.makkah_occupancies, makkah_target_distance = r.makkah_target_distance,
    makkah_meal_plan = r.makkah_meal_plan, makkah_exact_hotel_guarantee = r.makkah_exact_hotel_guarantee,
    makkah_hotel = r.makkah_hotel, makkah_exact_display_name = r.makkah_exact_display_name,
    madinah_accommodation_standard = r.madinah_accommodation_standard, madinah_customer_wording = r.madinah_customer_wording,
    madinah_nights = r.madinah_nights, madinah_occupancies = r.madinah_occupancies, madinah_target_distance = r.madinah_target_distance,
    madinah_meal_plan = r.madinah_meal_plan, madinah_exact_hotel_guarantee = r.madinah_exact_hotel_guarantee,
    madinah_hotel = r.madinah_hotel, madinah_exact_display_name = r.madinah_exact_display_name,
    transport_type = r.transport_type, transport_requirements = r.transport_requirements, inclusions = r.inclusions, exclusions = r.exclusions,
    document_requirements = r.document_requirements, seat_reservation_rule = r.seat_reservation_rule,
    selected_communication_templates = r.selected_communication_templates,
    default_group_capacity = r.default_group_capacity, default_group_status = r.default_group_status,
    group_readiness_checklist = r.group_readiness_checklist
  from (select (jsonb_populate_record(pk, p_content)).* from public.packages pk where pk.id = p_package_id) r
  where p.id = p_package_id;
end;
$$;

comment on function public.packages_apply_content(uuid, jsonb) is
  'Internal. Writes the allow-listed content columns of one package (keys absent from p_content keep their value). The caller has already checked role, capability, agency and locked the row. Not executable by signed-in users.';

revoke all on function public.package_content_columns() from public, anon;
grant execute on function public.package_content_columns() to authenticated, service_role;
revoke all on function public.package_field_tier(text) from public, anon;
grant execute on function public.package_field_tier(text) to authenticated, service_role;
revoke all on function public.package_itinerary_structure_changed(jsonb, jsonb) from public, anon;
grant execute on function public.package_itinerary_structure_changed(jsonb, jsonb) to authenticated, service_role;
revoke all on function public.packages_apply_content(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.packages_apply_content(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
