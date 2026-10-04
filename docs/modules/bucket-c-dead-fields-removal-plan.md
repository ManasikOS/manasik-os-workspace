# Removing Bucket C — Safest Path

Status: **plan only. Nothing implemented.**

This supersedes §4.3.1 of
[docs/package-departure-architecture-master-plan.md](package-departure-architecture-master-plan.md), which assumed a
~1,800-line wizard redesign was needed. Having now read both wizard step files end to end, that assumption was wrong
in the safe direction: **the fields in question are already dead code in the UI.** The real fix is far smaller and
far lower-risk than originally scoped.

---

## 1. What I actually found

I checked, for every Bucket-C field, whether the wizard's own `updateField(...)` calls in Step 3 and Step 4 ever
write to it, and whether `create-package/mappers.ts`, `schemas.ts`, or `server-schema.ts` validate it.

### 1.1 Flight fields — 100% dead

`grep -oE 'updateField\("[a-zA-Z]+"' step-3-journey-template.tsx` returns exactly: `days`, `nights`, `duration`,
`departureOrigin`, `arrivalGateway`, `returnGateway`, `flightsIncluded`, `outboundRoute`, `returnRoute`,
`preferredAirlines`, `routingPreference`, `cabinClass`, `itinerary`.

Never called: `airline`, `departureAirport`, `arrivalAirport`, `departureTime`, `arrivalTime`, `transitAirport`,
`transitArrivalTime`, `transitDepartureTime`, `flightLegs`, `flightRoutes`, `flightOptions`, `flightType`.

`INITIAL_PACKAGE_FORM_DATA` (`create-package/types.ts:529-541`) seeds these with **fixed sample values** —
`airline: "Sri Lankan Airlines"`, `departureTime: "14:30"`, `arrivalAirport: "Jeddah (JED)"` — and because nothing in
the UI can change them, **every package ever created through the wizard carries these exact same values**, verbatim,
regardless of what the package actually is. `mappers.ts` round-trips them (DB → form → DB) on every save, but no
screen reads them as authoritative — `lib/data/packages-template.ts` (the Phase 1 fix) never selects them, and a
repo-wide search found no other consumer of `packages.airline` / `.departure_airport` / `.flight_legs` etc. outside
the wizard's own mapper.

**Consequence: removing these 12 fields changes nothing a user has ever seen or set.** There is no real per-package
data to lose — every row's value is identical, constant junk.

### 1.2 Hotel "exact guarantee" fields — mixed: 2 live, 6 dead

Step 4 renders exactly two fields per city, gated behind the `makkahExactHotelGuarantee` / `madinahExactHotelGuarantee`
toggle: **Hotel Name** (`makkahHotel`) and **Display Name** (`makkahExactDisplayName`) — and the equivalent Madinah
pair. This is a real, intentional feature: "we guarantee this exact hotel, not just a standard," toggled per
template. It is not what I originally flagged as a problem — the toggle already correctly separates "generic,
reusable standard" from "this specific promise," which is the right design.

Never rendered anywhere: `makkahHotelRating`, `makkahDistance`, `makkahExactNotes` (+ the Madinah trio). Same
pattern as the flight fields: fixed defaults (`"5 Star"`, `"Clock Tower / 100m from Haram"`,
`"Guaranteed Tower 1 reservation"`) baked into `INITIAL_PACKAGE_FORM_DATA`, round-tripped by `mappers.ts`, never
editable, never read downstream. Confirmed distinct from the live, meaningful `makkahTargetDistance` field (which
Step 4 *does* render and which `loadTemplateDefinition()` *does* map into `AccommodationStandardSnapshot`).

### 1.3 The corrected field list

| Field (camelCase in the form) | DB column | Verdict |
|---|---|---|
| `flightType`, `airline`, `departureAirport`, `arrivalAirport`, `departureTime`, `arrivalTime`, `transitAirport`, `transitArrivalTime`, `transitDepartureTime`, `flightLegs`, `flightRoutes`, `flightOptions` | `flight_type`, `airline`, `departure_airport`, `arrival_airport`, `departure_time`, `arrival_time`, `transit_airport`, `transit_arrival_time`, `transit_departure_time`, `flight_legs`, `flight_routes`, `flight_options` | **Dead — remove** |
| `makkahHotelRating`, `makkahDistance`, `makkahExactNotes`, `madinahHotelRating`, `madinahDistance`, `madinahExactNotes` | `makkah_hotel_rating`, `makkah_distance`, `makkah_exact_notes`, `madinah_hotel_rating`, `madinah_distance`, `madinah_exact_notes` | **Dead — remove** |
| `makkahExactHotelGuarantee`, `makkahHotel`, `makkahExactDisplayName`, `madinahExactHotelGuarantee`, `madinahHotel`, `madinahExactDisplayName` | matching columns | **Live — keep, no change** |
| `makkahTargetDistance`, `madinahTargetDistance` | matching columns | **Live — keep, no change** (this is the field the master plan's "target distance" standard actually refers to) |

18 fields to remove. 12 fields (the exact-guarantee feature + target distance) untouched.

---

## 2. Why this is now a genuinely safe change

The property that makes a deletion "safe" is: **no code path exercised by a real user can observe the difference.**
That holds here for three independent reasons:

1. **No UI writes them.** Deleting the type fields removes nothing from any screen — there is no screen.
2. **No UI reads them either**, except to redisplay the same constant default back into a hidden form field that is
   never rendered.
3. **No other module reads them.** Confirmed by grepping every `.ts`/`.tsx` file outside `create-package/` for the
   snake_case column names — the only matches were the *departure_group_flights* table's own, unrelated
   `airline`/`arrival_time` etc. columns (a live, different, correctly-scoped table from Phase 3's `buildFlights()`),
   never `packages.*`.

The one thing that is **not** safe to assume: that no row in the live database has a value other than the hardcoded
default. Nothing in this codebase's UI could have put a different value there, but a manual SQL edit, a future
seed script, or a bulk import tool this plan hasn't seen could have. Phase 0 below exists specifically to rule that
out before anything is deleted, rather than assuming it.

---

## 3. The phased plan

### Phase 0 — Verify, don't assume (read-only, zero risk)

Run this against the live database before touching any code:

```sql
select
  count(*) filter (where airline is distinct from 'Sri Lankan Airlines') as airline_drift,
  count(*) filter (where departure_airport is distinct from 'Colombo (CMB)') as dep_airport_drift,
  count(*) filter (where arrival_airport is distinct from 'Jeddah (JED)') as arr_airport_drift,
  count(*) filter (where departure_time is distinct from '14:30') as dep_time_drift,
  count(*) filter (where arrival_time is distinct from '18:45') as arr_time_drift,
  count(*) filter (where flight_type is distinct from 'Direct') as flight_type_drift,
  count(*) filter (where jsonb_array_length(coalesce(flight_legs, '[]'::jsonb)) > 0) as flight_legs_drift,
  count(*) filter (where jsonb_array_length(coalesce(flight_routes, '[]'::jsonb)) > 0) as flight_routes_drift,
  count(*) filter (where jsonb_array_length(coalesce(flight_options, '[]'::jsonb)) > 0) as flight_options_drift,
  count(*) filter (where makkah_hotel_rating is distinct from '5 Star') as makkah_rating_drift,
  count(*) filter (where makkah_distance is distinct from 'Clock Tower / 100m from Haram') as makkah_distance_drift,
  count(*) filter (where makkah_exact_notes is distinct from 'Guaranteed Tower 1 reservation') as makkah_notes_drift,
  count(*) filter (where madinah_hotel_rating is distinct from '5 Star') as madinah_rating_drift,
  count(*) filter (where madinah_distance is distinct from '150m from Prophet''s Mosque') as madinah_distance_drift,
  count(*) filter (where madinah_exact_notes is distinct from 'Central Northern area hotel') as madinah_notes_drift
from public.packages;
```

**Every column must come back `0` before proceeding to Phase 1.** If any is non-zero, stop — that means something
(a script, a manual edit, an import this plan didn't account for) put real data there, and the field needs to be
reclassified from "dead" to "needs a real migration path" before deletion, not silently discarded. This is exactly
the same discipline `20260908090000_departure_group_pricing.sql`'s backfill used before repointing every read site —
verify the assumption against real data, then act on it.

### Phase 1 — Remove from the application layer only (no DB migration, no UI change)

Because nothing renders these fields, this phase touches only `create-package/types.ts` and
`create-package/mappers.ts` — never a `.tsx` file, so there is no UI diff to review or regress:

1. **`create-package/types.ts`**: delete the 18 fields from the `PackageFormData` interface and from
   `INITIAL_PACKAGE_FORM_DATA`.
2. **`create-package/mappers.ts`**: delete the corresponding lines in both `formToRow` (the ~12 `field: form.x` write
   lines) and `rowToFormData` (the ~12 `fieldName: row.x` read lines).
3. **`lib/types/database.ts`**: mark the 18 `PackageRow` fields `?:` (optional) rather than deleting them yet — the
   database still has the columns (Phase 3 hasn't run), and Postgres/PostgREST will still return them in a
   `select("*")`. Making them optional means `PackageRow` stops *requiring* every consumer to carry them, without
   requiring the DB to change in the same release.
4. Run `npx tsc --noEmit` — this is the actual safety net for this phase. Removing a field from `PackageFormData`
   makes every remaining reference to it a compile error, so if step 1/2 missed a reference anywhere, the build
   fails loudly instead of shipping a silent bug. Given the grep in §1.1/§1.2 already found zero references outside
   these two files, a clean compile here is strong confirmation, not a formality.
5. Run `npx eslint .` for unused-import fallout (e.g. an icon imported only for a field's now-deleted input).

**Rollback if anything goes wrong:** revert the two files. No migration to reverse, no data to restore — this phase
never touches the database.

**What ships:** the wizard is byte-for-byte identical on screen. The only observable change is that
`GET /packages/[id]` (or any export) stops including 18 keys whose value was always the same hardcoded string
anyway. Safe to ship on its own, with nothing else in this plan.

### Phase 2 — Stop writing them at the database level (additive migration, reversible)

Once Phase 1 has been live for a normal release cycle with no reports of a missing field (there won't be any — see
§2 — but this is the checkpoint where reality gets to disagree with the plan):

```sql
-- Drop the hardcoded defaults so a future insert that still names these
-- columns (a script, a fixture) gets NULL instead of silently reintroducing
-- the fake data — without dropping the columns themselves yet.
alter table public.packages
  alter column airline                 drop default,
  alter column departure_airport       drop default,
  alter column arrival_airport         drop default,
  alter column departure_time          drop default,
  alter column arrival_time            drop default,
  alter column transit_airport         drop default,
  alter column transit_arrival_time    drop default,
  alter column transit_departure_time  drop default,
  alter column flight_legs             drop default,
  alter column flight_routes           drop default,
  alter column flight_options          drop default,
  alter column flight_type             drop default,
  alter column makkah_hotel_rating     drop default,
  alter column makkah_distance         drop default,
  alter column makkah_exact_notes      drop default,
  alter column madinah_hotel_rating    drop default,
  alter column madinah_distance        drop default,
  alter column madinah_exact_notes     drop default;
```

This is purely additive (`drop default` is instant, no table rewrite, no lock beyond a brief metadata lock) and
fully reversible (`alter column ... set default '...'` restores it). It changes nothing for existing rows. Its only
purpose is to stop the columns from *manufacturing* fake-looking data for any row created after Phase 1, from any
code path this plan hasn't seen (a seed script, a support tool).

### Phase 3 — Drop the columns (only after Phase 2 has run clean, genuinely optional)

```sql
alter table public.packages
  drop column if exists airline,
  drop column if exists departure_airport,
  drop column if exists arrival_airport,
  drop column if exists departure_time,
  drop column if exists arrival_time,
  drop column if exists transit_airport,
  drop column if exists transit_arrival_time,
  drop column if exists transit_departure_time,
  drop column if exists flight_legs,
  drop column if exists flight_routes,
  drop column if exists flight_options,
  drop column if exists flight_type,
  drop column if exists makkah_hotel_rating,
  drop column if exists makkah_distance,
  drop column if exists makkah_exact_notes,
  drop column if exists madinah_hotel_rating,
  drop column if exists madinah_distance,
  drop column if exists madinah_exact_notes;

notify pgrst, 'reload schema';
```

**This step is not required for correctness** — Phase 1 already made the application forget these columns exist.
Dropping them only reclaims schema clarity (a smaller `packages` table, nothing left to accidentally re-read). It is
the one genuinely irreversible step in this plan (a `drop column` cannot be undone without a backup), so:

- Take it only after Phase 1 has been live long enough that you're confident nothing external (a report, an
  analytics query, a support script) reads these columns.
- Take a fresh Phase-0-style drift check immediately before running it, not just once at the start.
- If in doubt, skip Phase 3 indefinitely. An unused, defaultless, nullable column costs nothing to leave in place.

---

## 4. What this plan deliberately does NOT do

- It does **not** touch `step-3-journey-template.tsx` or `step-4-service-standards.tsx` — zero lines, zero risk,
  because neither file references any of the 18 fields.
- It does **not** touch the exact-hotel-guarantee feature (`makkahHotel`, `makkahExactDisplayName` + Madinah pair,
  `makkahTargetDistance` + Madinah pair) — those are live, correctly designed, and out of scope.
- It does **not** add a "routing intent" redesign of Step 3 (the master plan's original §4.3.1 idea) — Step 3
  already only collects `departureOrigin` / `arrivalGateway` / `returnGateway` / `preferredAirlines` /
  `routingPreference` / `cabinClass`, which *is* routing intent. There was nothing to redesign; the fields I thought
  needed reshaping were never built into the UI in the first place.
- It does **not** touch `buildFlights()`, `loadTemplateDefinition()`, or any Departure Groups code from the
  previous phases — none of them read these 18 fields today, so removing the fields cannot change their behavior.

## 5. Effort and risk, compared honestly to the original estimate

| | Original estimate (§4.3.1) | This plan |
|---|---|---|
| Files touched | 2 wizard components (~1,838 lines), schemas, migration | 2 small files (`types.ts`, `mappers.ts`) in Phase 1; SQL-only in Phases 2–3 |
| UI change | A full Step 3 redesign | None |
| Regression surface | Autosave, validation, step navigation, existing drafts | A `tsc --noEmit` compile error is the only way this phase can fail, and it fails at build time, not at runtime |
| Data risk | Assumed some packages might have real flight/hotel-detail data worth migrating | Verified: none can, because no UI path ever wrote non-default values — Phase 0 confirms this against the real database before anything is deleted |
| Reversibility | Unclear | Phase 1: git revert. Phase 2: one `alter column ... set default`. Phase 3: none (by design, taken last, optional) |
