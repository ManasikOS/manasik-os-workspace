# Packages Phase 0 — verification on staging (TASK-043)

Date: 2026-10-09. Target: Supabase project `klognjpwmqwlgeibvanf` ("Manasik OS", recorded as staging in `docs/progress/2026-09-26-inbox-lr0-release-baseline.md`). The second project, `bidmihfsljrurlnraqmf` ("ManasikOS Production"), was **not touched**.

## How far this got, honestly

Read-only catalog and advisor queries ran and are reported below. The **behavioural tests** (acting as a role and trying the forbidden thing, inside a transaction that rolls back) were **blocked by the permission classifier** and were not run. A later read query on the payment-summary view was also blocked. Nothing was written to any database. The test script is at the bottom for you (or me, once you allow it) to run.

## Confirmed from the live catalog (read-only)

| Finding | Result | Evidence |
|---|---|---|
| Staging matches the repo | Yes | The four `packages` policies and the three triggers are exactly as in `20270119090000` and `20261005090000`. |
| PKG-01 status can be written directly | **Confirmed at policy level** | Triggers on `packages` are only `packages_bump_inbox_version`, `packages_enforce_marketing_scope`, `packages_set_updated_at`. No guard on `status`. UPDATE policy lets ADMIN/OPERATIONS change any column; INSERT lets them insert `Open for Sale`. |
| PKG-03 MARKETING sees all drafts | **Confirmed at policy level** | SELECT policy is `agency_id = current_agency_id() AND staff_role_in(ADMIN, CEO, OPERATIONS, FINANCE, MARKETING, VISA)`. No status or owner condition. |
| PKG-04 DB ignores custom roles | **Confirmed at policy level** | Every policy uses `staff_role_in(...)` on the base tier only. |
| PKG-05 forged version snapshot | **Callable** | `package_versions_create(uuid, jsonb)` is `SECURITY DEFINER` and executable by `authenticated`; the security advisor flags it. Behavioural proof pending (T3). |
| PKG-06 agent reads whole row | **Confirmed by policy text** | "agent read allocated packages" is row-only with no status filter. **No live exposure today:** `agent_package_allocations` has 0 rows on staging. |
| PKG-16 list RPC grants | **Confirmed** | `list_packages_with_usage` ACL includes `=X` (PUBLIC) and `anon=X`. The MARKETING column-scope trigger **is present** on staging. |

## New things found that the source review missed

1. **`staff_role_in` has a mutable `search_path`** (security advisor, WARN). Every package policy and the planned `has_package_capability` helper depend on it. Add a pinned `search_path` to Phase 1 step 6, before anything is built on it.
2. **Delete is wider than I wrote.** Foreign keys to `packages(id)` and their `on delete`: `agent_package_allocations`, `package_activity_logs`, `package_versions`, `package_content`, `package_faqs`, `package_media`, `package_seo_analyses` → **cascade**; `leads`, `lead_quotes`, `campaigns`, `agent_booking_submissions`, `duplicated_from` → **set null** (the link silently disappears); `departure_groups`, `departure_group_package_snapshots` → restrict. So deleting a package removes agent allocations and the website/SEO content, and unlinks leads and quotes with no record. The Phase 3 delete function must check or report all of these, not only departure groups.
3. **Four package tables I had not reviewed:** `package_content`, `package_faqs`, `package_media`, `package_seo_analyses` (website content and SEO scoring). Safe today: RLS on, no policies, no grants to `anon` or `authenticated`, so only the server key reaches them, and no app code reads them yet. They need their own RLS and capability rules **before** any feature uses them.
4. **Every package change bumps the inbox AI knowledge version** (trigger `packages_bump_inbox_version`). Package edits therefore also change what the inbox assistant answers from; the approval flow for Tier 1/2 is doubly justified.
5. **Staging has no MARKETING, FINANCE, VISA or agent users** (2 ADMIN, 2 OPERATIONS of which 1 INVITED, 1 CEO). Two profiles (one ADMIN, the CEO) have no `role_id`, so they use the built-in defaults. Role tests need a temporary re-role inside a rolled-back transaction, as in the script.
6. Advisors also list 23 unrelated "RLS enabled, no policy" tables, 12 other mutable-`search_path` functions, 26 other signed-in-executable definer functions and leaked-password protection off. These are outside the Packages scope; I did not change them.

## Still unverified (needs the script below)

T1 MARKETING direct read of others' drafts · T2 direct `Open for Sale` insert and status update with no log row · T3 forged snapshot accepted · T4 payment-summary / group visibility for MARKETING (PKG-12) · T5 custom ADMIN-tier role with `deletePackage` off can still delete directly · T6 MARKETING update of others' / live packages · T7 anon execute on the list RPC (already shown by the ACL).

## Test script

Paste into the Supabase SQL editor of the **staging** project only. It does everything inside one function call that ends by raising an error carrying the results, so every change rolls back. It re-roles the CEO profile temporarily and edits one `role_permissions` row; both roll back. Do not run it on production.

```sql
create or replace function pg_temp.phase0() returns void language plpgsql as $f$
declare
  admin_id uuid := '04f2ba84-e50b-4415-b2fe-1cf1700eb255';
  ceo_id   uuid := '7d8f5666-e993-413f-b1d3-bf0a54ac0e38';
  out text[] := '{}';
  n int; n2 int; pid uuid; pid2 uuid; logs_before int; logs_after int; st text; role_id_admin uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    insert into public.packages(title,status,internal_code) values ('PH0 direct live','Open for Sale','PH0-LIVE') returning id into pid;
    out := out || 'T2a direct INSERT as Open for Sale: ALLOWED';
  exception when others then out := out || ('T2a REFUSED '||sqlerrm); end;

  begin
    insert into public.packages(title,status,internal_code) values ('PH0 draft','Draft','PH0-DRAFT') returning id into pid2;
    select count(*) into logs_before from public.package_activity_logs where package_id=pid2;
    update public.packages set status='Open for Sale', published_at=now() where id=pid2;
    select count(*) into logs_after from public.package_activity_logs where package_id=pid2;
    select status into st from public.packages where id=pid2;
    out := out || format('T2b direct status update -> %s ; log rows before=%s after=%s', st, logs_before, logs_after);
  exception when others then out := out || ('T2b REFUSED '||sqlerrm); end;

  begin
    perform public.package_versions_create(pid2, '{"forged":true}'::jsonb);
    select count(*) into n from public.package_versions where package_id=pid2 and snapshot ? 'forged';
    out := out || format('T3 forged snapshot accepted; rows=%s', n);
  exception when others then out := out || ('T3 REFUSED '||sqlerrm); end;

  begin
    select role_id into role_id_admin from public.staff_profiles where id=admin_id;
    execute 'reset role';
    update public.role_permissions set capabilities = jsonb_set(capabilities,'{deletePackage}','false')
      where role_id=role_id_admin and module='packages';
    get diagnostics n = row_count;
    perform set_config('request.jwt.claims', json_build_object('sub',admin_id,'role','authenticated')::text, true);
    execute 'set local role authenticated';
    delete from public.packages where id=pid2;
    get diagnostics n2 = row_count;
    out := out || format('T5 permission rows edited=%s ; direct DELETE removed=%s (1 = DB ignored the restriction)', n, n2);
  exception when others then out := out || ('T5 REFUSED '||sqlerrm); end;

  execute 'reset role';
  update public.staff_profiles set role='MARKETING' where id=ceo_id;
  perform set_config('request.jwt.claims', json_build_object('sub',ceo_id,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    select count(*) into n from public.packages;
    select count(*) into n2 from public.packages where status<>'Open for Sale' and owner_id<>ceo_id;
    out := out || format('T1 MARKETING sees %s packages; %s are others'' non-live (want 0)', n, n2);
    select count(*) into n from public.list_packages_with_usage(null,null);
    out := out || format('T1b list RPC p_role=null: %s rows', n);
  exception when others then out := out || ('T1 error '||sqlerrm); end;
  begin
    select count(*) into n from public.departure_group_payment_summaries;
    select count(*) into n2 from public.departure_groups;
    out := out || format('T4 MARKETING: payment summaries=%s, groups=%s', n, n2);
  exception when others then out := out || ('T4 REFUSED '||sqlerrm); end;
  begin
    update public.packages set title='hijack' where id in (select id from public.packages where status<>'Open for Sale' and owner_id<>ceo_id limit 1);
    get diagnostics n = row_count;
    out := out || format('T6 MARKETING update of others'' non-live package: rows=%s', n);
  exception when others then out := out || ('T6 REFUSED '||sqlerrm); end;
  begin
    update public.packages set title='hijack' where status='Open for Sale';
    get diagnostics n = row_count;
    out := out || format('T6b MARKETING title change on live package: rows=%s', n);
  exception when others then out := out || ('T6b REFUSED (trigger works) '||sqlerrm); end;

  execute 'reset role';
  raise exception 'PHASE0 RESULTS (rolled back):%', E'\n'||array_to_string(out, E'\n');
end $f$;
select pg_temp.phase0();
```

Expected if the findings are real: T2a ALLOWED; T2b status becomes Open for Sale with log rows 0→0; T3 accepted; T5 removed=1; T1 sees all 4 packages with 2 or more non-live (the two Archived packages are owned by the ADMIN, so "others' non-live" should be 2); T6 should change 0 rows (the update policy hides them) and T6b should be REFUSED by the trigger; any other result is a hole.

## Behavioural results (run by the user on staging, rolled back)

| Test | Result | Verdict |
|---|---|---|
| T2a direct INSERT as Open for Sale | Script bug: `out || 'literal'` was read as an array literal, so the check was inconclusive. (The sub-block's insert was rolled back by its own exception handler.) Re-run with `array_append(out, '…')`. | **Inconclusive** — the INSERT policy text already permits it; low risk of a different answer |
| T2b direct status update Draft → Open for Sale | Succeeded; activity-log rows 0 → 0 | **PKG-01 confirmed**: status changes with no log and no validation |
| T3 forged version snapshot | Accepted; the forged row exists | **PKG-05 confirmed** |
| T5 custom role with `deletePackage` off | Permission row edited; direct DELETE still removed the row | **PKG-04 confirmed**: the database ignores the restriction |
| T1 MARKETING direct read | Sees all 4 packages, 2 of them others' non-live (the two Archived) | **PKG-03 confirmed** |
| T1b list RPC with `p_role = null` as MARKETING | 4 rows | **PKG-03 confirmed** via the RPC too |
| T4 MARKETING payment summaries / groups | 1 summary row, 1 group visible | **PKG-12 confirmed**: a MARKETING user can read group revenue data; the package page also shows it with no finance check |
| T6 MARKETING update of others' non-live package | 0 rows | Sound (update policy hides them) |
| T6b MARKETING title change on live package | Refused by the trigger | Sound (trigger works on staging) |

Not yet run: T7 (anon execute on the list RPC; the ACL already shows `anon` and PUBLIC), PKG-06 behavioural (no agent users or allocations on staging), PKG-10 FK list (done from the catalog).
