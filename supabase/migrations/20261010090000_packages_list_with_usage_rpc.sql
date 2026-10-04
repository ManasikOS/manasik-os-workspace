-- Packages Phase 5 — a single RPC for the list screen's catalogue + usage
-- read, replacing the two-query pattern that silently lost data on a large
-- catalogue.
--
-- See docs/modules/packages-production-readiness-plan.md, Phase 5, finding F1:
-- `listPackages()` (lib/data/packages-repository.ts) ran one query for the
-- package rows, then a second `package_usage` query with
-- `.in("package_id", <every id just fetched>)`. PostgREST puts that whole id
-- list in the request URL — with a few hundred packages the URL goes over
-- the server's length limit, the query errors, `loadUsageMap()` swallowed
-- the error and returned an empty map, and every row silently showed 0
-- groups. That also mis-enabled the Delete menu item (blocked correctly by
-- the server, but visibly wrong in the UI) for packages that actually had
-- live groups.
--
-- `list_packages_with_usage()` does the whole read as one LEFT JOIN, so
-- there is no id list to overflow a URL with in the first place — not a
-- bigger limit, but the failure mode is gone entirely. It carries the same
-- role-based visibility rule `listPackages()` applied in TS (`.or(...)` for
-- MARKETING) as a SQL predicate instead, and is otherwise a plain
-- `security invoker` function — RLS on `packages` still applies exactly as
-- it does for a normal `select`.
create or replace function public.list_packages_with_usage(
  p_role text default null,
  p_current_user_id uuid default null
) returns table (
  id                                uuid,
  title                             text,
  internal_code                     text,
  description                       text,
  journey_type                      text,
  category                          text,
  package_category                  text,
  branch                            text,
  status                            text,
  visibility                        text,
  featured                          boolean,
  duration                          text,
  days                              integer,
  nights                            integer,
  max_pilgrims                      integer,
  default_capacity                  integer,
  cancellation_policy               text,
  itinerary_days                    integer,
  payment_milestones_count          integer,
  transport_requirements_count      integer,
  inclusions_count                  integer,
  exclusions_count                  integer,
  included_services_count           integer,
  document_requirements_count       integer,
  group_readiness_checklist_count   integer,
  archived_at                       timestamptz,
  created_at                        timestamptz,
  updated_at                        timestamptz,
  owner_id                          uuid,
  group_count                       bigint,
  live_group_count                  bigint,
  seats_booked                      bigint,
  seats_capacity                    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id, p.title, p.internal_code, p.description, p.journey_type, p.category,
    p.package_category, p.branch, p.status, p.visibility, p.featured,
    p.duration, p.days, p.nights, p.max_pilgrims, p.default_capacity,
    p.cancellation_policy, p.itinerary_days, p.payment_milestones_count,
    p.transport_requirements_count, p.inclusions_count, p.exclusions_count,
    p.included_services_count, p.document_requirements_count,
    p.group_readiness_checklist_count, p.archived_at, p.created_at, p.updated_at,
    p.owner_id,
    coalesce(u.group_count, 0)::bigint       as group_count,
    coalesce(u.live_group_count, 0)::bigint  as live_group_count,
    coalesce(u.seats_booked, 0)::bigint      as seats_booked,
    coalesce(u.seats_capacity, 0)::bigint    as seats_capacity
  from public.packages p
  left join public.package_usage u on u.package_id = p.id
  where p_role is distinct from 'MARKETING'
     or p.status = 'Open for Sale'
     or (p_current_user_id is not null and p.owner_id = p_current_user_id)
  order by p.updated_at desc;
$$;

comment on function public.list_packages_with_usage(text, uuid) is
  'One-query replacement for listPackages()''s old two-query (list + .in(ids) usage) pattern. security invoker — RLS on packages still applies to the caller exactly as a plain select would. p_role/p_current_user_id reproduce the MARKETING-only visibility rule (see canRoleViewPackage) as a SQL predicate rather than a client-side filter.';

grant execute on function public.list_packages_with_usage(text, uuid) to authenticated;
