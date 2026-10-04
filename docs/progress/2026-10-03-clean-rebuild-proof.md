# Clean-rebuild proof (TASK-032 S5, TASK-029 P2.2)

**Question.** Can the repository build a working database on its own? Production will be a new project built from the migrations, so staging, which
was partly built by hand, proves nothing until the repository has been shown to build from nothing.

**Method.** On 2026-10-03 every migration in `supabase/migrations` (226 files) was applied, in filename order and each in its own transaction, to an
**empty** local Supabase database (the standard self-hosted stack in Docker, Postgres 17), with `scripts/local/rebuild-from-migrations.sh`. The result was
then compared, category by category, with live staging. Nothing was changed on staging by the comparison.

## Result

**It did not build.** Two migrations fail on a fresh database. With a local patch for each, all 226 apply, and the rebuilt schema then matches staging
in everything the application uses. The differences are below.

### A. Migrations that cannot be built from scratch (fixed in place)

| Migration | Failure | Cause | Fix |
|---|---|---|---|
| `20261114090001_pilgrim_service_customisation` | `there is no unique or exclusion constraint matching the ON CONFLICT specification` | The seed inserts `on conflict (code)`, but by then `20260828090000` has made the add-on code unique per agency, `(agency_id, code)` | `on conflict (agency_id, code)` |
| `20261126090000_lock_down_definer_functions` | `function public.increment_conversation_unread(uuid) does not exist` | That function was created by hand on staging and by no migration; the migration revokes privileges on it | the two revokes are guarded by `to_regprocedure(...) is not null` |

Both are edited in place, which the repository rule "never edit an applied migration" discourages. They are the only option here: a new migration cannot fix a
migration that fails before it runs. Each edit has an identical effect on a database that already applied the migration (nothing is re-run), so staging is unaffected.

### B. Staging was behind the repository (security: fixed by a new migration)

Migrations recorded as applied on staging whose effect is **not** in the staging database. The migration history matches by name, which is why the gate's G2 passes;
only a content comparison finds this.

| Missing on staging | Effect | Where it comes from |
|---|---|---|
| Trigger `packages_enforce_marketing_scope` and its function | A MARKETING user the row policy lets update a package could change **any** column, not only the `featured` flag | `20261005090000` |
| The policy `staff write departure_group_activity_logs` should not exist | Any signed-in user of the agency, a guide included, could rewrite or delete a departure group's **audit log** | present on staging; dropped by `20260822090000` |

Found while testing the fix: the repository's own marketing-scope trigger was **broken**. It compared the old and new row, but in a BEFORE trigger the table's generated columns
(`itinerary_days` and the `*_count` columns) are not yet computed in the new row, so they always looked changed and MARKETING could not update anything, not even `featured`. It was
invisible because the trigger never ran on staging. The new migration re-creates the function with generated columns excluded automatically.

### C. A fresh build was looser than staging (fixed by a new migration)

| On a fresh build | Why it matters | Fix |
|---|---|---|
| `reset_agency_business_data()` (no argument) exists and any signed-in user can call it (it checks for an administrator inside) | It deletes an agency's business data. Staging does not have it; the application only calls the `(uuid)` version through the service role | dropped |
| `packages_enforce_marketing_column_scope()` is a security-definer trigger function executable by `anon` | The go-live gate (G3) correctly reports it. A trigger function needs no execute privilege to fire | privileges revoked |

All of B and C are in `20270106090000_clean_rebuild_alignment.sql`, with a 12-assertion database test that passes on the rebuilt database and on staging (the latter in a
rolled-back transaction).

### D. Staging-only leftovers (no code uses any of them; owner's decision, not changed)

- Tables: `ai_agent_settings`, `ai_model_roles`, `package_content`, `package_faqs`, `package_media`, `package_seo_analyses`.
- Functions: `increment_conversation_unread(uuid)`, `whatsapp_read_access_token(uuid)`, `whatsapp_store_access_token(text, text)`.
- Columns: 40 on `packages` that `20261008090000_packages_drop_deprecated_columns.sql` was meant to drop (prices, flight routing and similar; that migration is recorded as applied on
  staging but did not take effect), `departure_group_bookings.api_client_key_id` and `.channel`, `departure_groups.public_listed`.
- Bucket: an empty `whatsapp-media`. No migration creates it and no code uses it, so the gate's required-bucket list no longer includes it.

### E. Identical on both

The 16 scheduled jobs, the 9 extensions, the 226 migration names, the 33 storage policies, the 32 views, and the whole tenant-isolation audit (no table without row-level security, no
always-true policy, no exposed server-only table, no policy without an agency check).

## Status of the proof itself

The two migration fixes were applied during the proof as throwaway patched copies (the files in the repository were still the unfixed ones), and the new migration was applied on top. **A final from-scratch run of the committed files, with no patches, is still to do** (reset the local stack, then run the script above); until then, treat "the repository builds from nothing" as proven for every migration except the two edited ones, whose edits are proven only as statements.

## What this proves, and what it does not

- **Proves:** the repository, with these fixes, builds a database from nothing, and the application's code references nothing that only staging has.
- **Does not prove:** that the application *works* on that database. That is the browser run (TASK-032 S6) against the rebuilt local stack.
- **A stronger gate check is now possible:** G2 compares migration names, which staging passed while missing two protections. A fingerprint of a clean rebuild, compared per category with the
  target, would have caught both. Worth adding to the gate before production.

## Reproducing it

```bash
bash scripts/local/rebuild-from-migrations.sh   # needs a local Supabase stack in Docker with an empty database; refuses a database that already has tables
```
