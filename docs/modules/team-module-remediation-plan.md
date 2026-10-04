# Team Module — Remediation Plan

Companion to `docs/team-module-implementation-plan.md` (the original build plan). That document
describes what the module *should* be; this one records what the shipped code actually does, why
inviting a team member does not produce a working user, and the ordered work to fix it.

**Status: plan only. Nothing here is implemented.**

Scope: `app/(main)/management/team/**`, `lib/data/team-repository.ts`, `lib/data/team.ts`,
`lib/access/team-access.ts`, `lib/validations/team.ts`, `lib/dal.ts`, `app/auth/**`,
`app/(auth)/login/**`, and the RLS/schema for `staff_profiles`, `staff_invitations`,
`staff_group_assignments`, `staff_activity_logs`, `agency_members`.

---

## 0. Executive summary

Inviting a team member does not fail loudly — it half-succeeds and then strands the account. There
are **four independent breaks on the single "invite a user" path**, and any one of them is enough to
make the feature look like "it doesn't create users":

1. **The invite email lands nowhere usable.** The link points at `/login?mode=setup`, which bypasses
   `/auth/confirm` and is not a mode the login page implements. There is no set-your-password screen
   at all, so an invitee can never obtain a password.
2. **Non-Admin invitees can never become `ACTIVE`.** `lib/dal.ts` flips `INVITED → ACTIVE` through the
   session client, but `staff_profiles_write` only grants writes to `current_staff_role() = 'ADMIN'`.
   For every other role the update is silently swallowed, so the person stays `INVITED`, and
   `getCurrentStaffRole()` then returns `staffId: null` — which makes `/management/team` call
   `notFound()`. The new user is locked out of the whole app, permanently.
3. **A partial invite is unrecoverable.** The `auth.users` row is created *before* the
   `staff_profiles` insert, with no compensating delete. Any failure after that point (RLS, a
   constraint, a network blip) leaves an orphaned auth identity, and every retry from then on
   returns `email_exists` forever.
4. **`agency_members` is never written for an invitee.** Only `provision_agency()` and the platform
   console insert into it, and there is no `authenticated` INSERT policy, so a server action cannot.
   Invited staff hold no membership row: the agency switcher never lists them and
   `switch_active_agency()` rejects them.

Beyond the invite path, three headline features are wired to a "Coming soon" toast rather than to
code: **Edit Profile** (both surfaces), **Change Role from the list row menu**, and **Extend Access
from a profile**. `updateStaffProfileSchema` exists in `lib/validations/team.ts` with no action and
no repository function behind it.

The rest of this document is the defect register (§1–§5, severity ordered) and the phased fix (§6).

---

## 1. Blocking — the invite → working user path

### B1. The invitation link bypasses `/auth/confirm` and has no destination

- **Evidence:** `lib/data/team-repository.ts:267` and `:362` —
  `inviteUserByEmail(email, { redirectTo: "${siteUrl}/login?mode=setup" })`.
  `app/(auth)/login/page.tsx:64` only understands `mode === "reset"`. `app/(auth)/README.md` lists
  only `/auth/confirm` and `/auth/callback` as configured Supabase redirect URLs.
- **What happens:** with stock templates Supabase's `/auth/v1/verify` bounces to `redirectTo` with the
  session in the URL **fragment**, which a Server Component can never read. With a `{{ .TokenHash }}`
  template it arrives as `?token_hash=&type=invite`, which the login page ignores. Either way the
  invitee sees a plain password form for an account that has no password.
- **Contrast:** `sendPasswordReset()` in the same file does this correctly —
  `/auth/confirm?next=/login?mode=reset`.
- **Fix:**
  - Change both `redirectTo` values to
    `${siteUrl}/auth/confirm?next=${encodeURIComponent("/login?mode=setup")}`.
  - Add `mode === "setup"` to `app/(auth)/login/page.tsx`, rendering the existing
    `reset-password-dialog.tsx` (which already calls `updatePasswordAction`) with setup copy —
    "Set your password" rather than "Reset your password". No new auth action is needed.
  - Document the **Invite user** email template in `app/(auth)/README.md`:
    `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=%2Flogin%3Fmode%3Dsetup`,
    and add `/auth/confirm` to the project's Redirect URLs (already required for reset — call it out
    explicitly for invite).
- **Verify:** invite a fresh address → the emailed link lands on the set-password screen → the
  password is accepted → the user reaches `/dashboard`.

### B2. Non-Admin invitees can never activate — `INVITED` is a permanent trap

- **Evidence:** `lib/dal.ts:57-79` updates `staff_profiles` and `staff_invitations` through the
  *session* client. `supabase/migrations/20260820090000_team_access.sql:190-206` —
  `staff_profiles_write` and `staff_invitations_write` are
  `for all ... using (current_staff_role() = 'ADMIN')`. There is **no self-update policy**. The
  `catch {}` at `lib/dal.ts:81` hides the denial.
- **Downstream:** `getCurrentStaffRole()` (`lib/data/departure-groups.ts:465`) returns
  `role: GUIDE, staffId: null` for any non-`ACTIVE` profile.
  `app/(main)/management/team/page.tsx:37` then calls `notFound()` because there is no `staffId` to
  redirect to. Every non-admin invitee is bricked. It also means `last_active_at` is never stamped
  for non-admins, so "Last Active" reads *Never* for the whole team and the **Accounts Needing
  Review** KPI counts everyone.
- **Fix (new migration, `supabase/migrations/2026XXXX_team_invitation_repair.sql`):**
  - `public.touch_own_activity()` — `security definer`, keys off `auth.uid()`, writes **only**
    `last_active_at`, `activated_at`, and `status` `INVITED → ACTIVE` on the caller's own row.
    An RPC rather than a self-UPDATE policy is deliberate: a broad self-update would let a Guide
    promote themselves to ADMIN.
  - `public.accept_own_invitation()` — `security definer`, flips the caller's `staff_invitations`
    rows `PENDING → ACCEPTED` and stamps `accepted_at`.
  - Both: `revoke all from public; grant execute to authenticated;` and no user-id parameter.
  - Rewrite `lib/dal.ts:touchLastActive` to call these two RPCs instead of writing the tables
    directly, and log the failure path (see D1) instead of swallowing it.
- **Verify:** invite an `OPERATIONS` user, accept, sign in → row becomes `ACTIVE`, invitation becomes
  `ACCEPTED`, `last_active_at` is stamped, and `/management/team` redirects them to their own profile
  rather than 404ing.

### B3. A failed invite orphans the `auth.users` row and permanently poisons the email

- **Evidence:** `lib/data/team-repository.ts:266-296`. The admin `inviteUserByEmail` runs first; the
  `staff_profiles` insert (`:288`) and `staff_invitations` insert (`:300`) can each throw
  `TeamPersistenceError` with no cleanup. `staff_profiles_email_unique` is global on `lower(email)`,
  and the pre-check at `:243` is RLS-scoped, so it cannot see the orphan either.
- **Consequence:** after one failure that address returns `email_exists` forever and the operator has
  no in-app recovery — the most likely origin of a reported "it just doesn't create the user".
- **Fix:**
  - Move profile + invitation (+ membership, see B4) creation into one `security definer` RPC
    `public.create_staff_invitation(...)` so the inserts are a single transaction. Assert inside it
    that the caller is an `ADMIN` of the target agency.
  - Wrap the RPC call so that any failure after `inviteUserByEmail` calls
    `admin.auth.admin.deleteUser(staffId)` and returns `{ ok: false, error }` instead of throwing.
  - Add a reconciliation path for orphans already in the database: when `email_exists` comes back,
    look up the auth user by email with the admin client; if no `staff_profiles` row exists for that
    id **in any agency**, adopt it (insert the profile for the current agency and re-send) instead of
    returning the dead-end message at `:277`.
- **Verify:** force the profile insert to fail (temporarily revoke the policy), invite, confirm no
  `auth.users` row survives, then invite the same address again successfully.

### B4. Invited staff get no `agency_members` row

- **Evidence:** `supabase/migrations/20260829090000_agency_membership.sql:55-90` backfills existing
  profiles once and then grants `authenticated` **no** INSERT/UPDATE/DELETE policy. `inviteStaff()`
  never touches the table. `getCurrentStaffRole()` (`lib/data/departure-groups.ts:427`) reads it for
  the agency switcher.
- **Consequence:** an invitee has no membership; the switcher shows nothing; `switch_active_agency()`
  raises `Not an active member of that agency.` If they are ever added to a second agency they can
  never switch back.
- **Fix:** `create_staff_invitation` (B3) also inserts
  `agency_members (user_id, agency_id, role, status = 'INVITED', is_default = <true if first>)`.
  `accept_own_invitation()` moves it to `ACTIVE`. Lifecycle mutators keep it in sync — see C1.
- **Verify:** invite → `agency_members` row exists as `INVITED`; accept → `ACTIVE`; change their role
  → both tables agree.

---

## 2. Critical — features that silently do nothing

### C1. `staff_profiles` and `agency_members` drift apart on every lifecycle change

`changeStaffRole` (`team-repository.ts:418`), `deactivateStaff` (`:470`) and `reactivateStaff`
(`:524`) write only `staff_profiles`. `agency_members.role` / `.status` keep the stale value, and
`switch_active_agency()` will **write the stale role back onto `staff_profiles`** the next time the
person switches — a silent privilege regression, or escalation if they were demoted.

**Fix:** a trigger on `staff_profiles` mirroring `role` / `status` onto the matching `agency_members`
row. Prefer the trigger over an RPC called from each mutator — it cannot be forgotten by a future one.

### C2. Edit Profile is not implemented anywhere

- `app/(main)/management/team/components/team-list.tsx:130` — `onEdit: () => notReady("Edit Profile")`.
- `app/(main)/management/team/[userId]/components/team-member-detail.tsx:143` — same toast.
- `updateStaffProfileSchema` exists (`lib/validations/team.ts`) with **no** `updateStaffProfileAction`
  and **no** repository function.

**Fix:** add `updateStaffProfile()` to `team-repository.ts` (writing `full_name`, `whatsapp`,
`job_title`, `branch`, `branch_id`, `employment_type`, `access_starts_on`, `access_ends_on`, plus a
`PROFILE_UPDATED` activity log carrying a before/after diff), `updateStaffProfileAction` in
`actions.ts` gated on `can.editProfile`, and an `edit-profile-sheet.tsx` following
`app/(main)/departure-groups/[groupId]/components/edit-group-details-sheet.tsx`. Wire both call sites.

### C3. Change Role from the list row menu is a toast

`team-list.tsx:132` — `onChangeRole: () => notReady("Change Role")`, even though
`components/change-role-dialog.tsx` is complete and working (it is already used from the profile's
Access tab). **Fix:** hold a `changeRoleTarget` in `TeamList` state and render `<ChangeRoleDialog>`
exactly as `DeactivateStaffDialog` is rendered. Roughly a ten-line change.

### C4. Extend Access is unreachable from a profile

`ExtendAccessDialog` renders only inside the list's expiring-soon banner (`team-list.tsx`, gated on
`can.editProfile && expiringSoon.length > 0`). A seasonal account that has **already lapsed** never
appears in that banner — `seasonalAccessExpiringSoon()` in `lib/data/team.ts` returns `false` once
expired — so there is no way to extend it. That is exactly the case `extendSeasonalAccess()` was
written for; its `wasExpired` branch is currently unreachable from the UI.

**Fix:** add "Extend Access" to the profile header overflow menu for `employmentType === "SEASONAL"`,
and add a row action in the list for any member whose access has lapsed.

### C5. Seasonal expiry has no scheduler — `SEASONAL_INACTIVE` is never written

`lib/data/team.ts` documents this ("only flips when a job runs — there is none yet"). Display is
reconciled at read time by `effectiveAccountStatus()` and access is denied at read time by
`getCurrentStaffRole()`, so nothing is *unsafe* — but the stored status is permanently wrong, which
is why `extendSeasonalAccess`'s `current.status === "SEASONAL_INACTIVE"` branch never fires and an
extended-but-lapsed account can stay locked out.

**Fix:** (a) change `extendSeasonalAccess` to lift the block whenever `wasExpired` is true, regardless
of the stored status — small and correct today; do this first. Optionally (b) add a nightly cron route
beside the existing departure-ops scheduler
(`supabase/migrations/20260921090000_departure_ops_scheduler.sql` is the precedent) setting
`ACTIVE → SEASONAL_INACTIVE` where `access_ends_on < today`.

### C6. `revokeInvitation` is a one-way door

`team-repository.ts:395-414` marks the invitation `REVOKED` and the profile `DEACTIVATED` but leaves
the `auth.users` row alive. The duplicate check at `:243` then finds the profile and answers *"That
email is already on the team."*, while the admin API answers `email_exists`. The address can never be
re-invited.

**Fix:** when the profile never left `INVITED`, delete the auth user via the admin client after
marking the records — nothing references it yet. If the invitation *was* accepted, keep today's soft
deactivate. Also teach the duplicate check to offer reactivation when it finds a `DEACTIVATED`
profile, rather than a flat refusal (see H3).

### C7. Invitation expiry is decorative

`expires_at` is stamped at `now() + 7 days` and never read. Nothing moves `PENDING → EXPIRED`, so the
Invitation History sheet keeps offering **Resend / Revoke** on invitations Supabase has already
invalidated, and `pending_invitation_at` in `team_directory_rows` never clears.

**Fix:** derive it at read time in `toTeamInvitationListItems()` — `status === "PENDING" && expiresAt < now`
renders as `EXPIRED` — and exclude expired rows from `pending_invitation_at` in the view. A stored
transition needs the scheduler from C5 and is not worth it on its own.

---

## 3. High — correctness and multi-tenancy

### H1. `enforce_last_admin` is not agency-scoped

`supabase/migrations/20260822090000_rls_hardening.sql:557-588` counts
`staff_profiles where role='ADMIN' and status='ACTIVE'` with **no `agency_id` predicate**, relying
entirely on RLS to filter the trigger's own query. That is fragile and differs in shape from the
application-level checks in `changeStaffRole` / `deactivateStaff`.

**Fix:** add `and agency_id = old.agency_id` to both counts in `enforce_last_admin()`. Defensive, but
this trigger is the last guard between an agency and having zero admins.

### H2. Branch is still hardcoded to `COLOMBO | KANDY | ALL`

`lib/validations/team.ts:9` pins `BRANCHES` to those three literals and `BRANCH_LABELS` in
`lib/data/team-copy.ts` hardcodes their labels — but
`supabase/migrations/20260821090000_agency_settings.sql:40-62` created a per-agency `branches` table,
added `staff_profiles.branch_id`, and **dropped** `staff_profiles_branch_check` precisely because the
hardcoding was the defect. `inviteStaff()` never populates `branch_id`.

**Consequence:** any agency other than the seeded one gets meaningless branch options, and the
`branch_id` FK is dead everywhere in Team.

**Fix:** load branches per agency (`lib/data/settings-repository.ts` already queries `branches`), pass
them into the invite dialog and the new edit sheet as picker options, validate `branchId` as a uuid
belonging to the caller's agency, and write **both** `branch_id` and the `branch` display snapshot.
Keep `BRANCH_LABELS` only as a fallback for legacy rows.

### H3. Duplicate-email pre-check misses cross-agency and deactivated cases

`team-repository.ts:243` uses `.ilike("email", email)` through the RLS-scoped client. It cannot see
another agency's row (correct) nor distinguish "already on this team, active" from "deactivated here
and could be reactivated". Combined with B3/C6 this is what produces the dead-end message at `:277`.

**Fix:** branch the pre-check on the found profile's status — `ACTIVE`/`INVITED` → refuse;
`DEACTIVATED` → offer reactivation inline in the invite dialog.

### H4. `sendPasswordReset` runs on the session client and skips revalidation

`team-repository.ts` calls `db.auth.resetPasswordForEmail(...)` on the **caller's** client, so it
shares the acting admin's own auth rate limit. `sendPasswordResetAction` (`actions.ts`) returns the
repository result directly, skipping the `revalidateTeam()` every sibling action performs — so the
`PASSWORD_RESET_SENT` activity entry does not appear without a manual refresh.

**Fix:** add the missing `revalidateTeam(staffId)`, and prefer the admin client's
`generateLink({ type: "recovery" })` so the operation is not charged against the admin's session.

### H5. `access_starts_on` is never enforced

`getCurrentStaffRole()` checks only `access_ends_on`. Someone invited with a future start date can
sign in immediately.

**Fix:** add `profile.access_starts_on > colomboDayKey()` to the deny condition in
`getCurrentStaffRole()`, and mirror it in `effectiveAccountStatus()` for display.

### H6. Invite dialog can promise a WhatsApp send it cannot make

`invite-team-member-dialog.tsx` lets "Send invitation via WhatsApp" be ticked with an empty number.
`inviteStaffSchema` does not cross-validate, so `whatsappShareUrl` comes back `null` and the operator
is told the invitation was sent with no indication the WhatsApp half was dropped.

**Fix:** add a `.refine()` to `inviteStaffSchema` requiring a non-empty `whatsapp` when `sendVia`
includes `WHATSAPP`, and surface `fieldErrors.whatsapp` in the dialog — that field renders no error
slot at all today.

### H7. `window.open` for the WhatsApp deep link is popup-blocked

`invite-team-member-dialog.tsx` and `invitation-history-sheet.tsx` both call `window.open(...)` after
an `await`, so the browser no longer treats it as a user gesture and blocks it silently.

**Fix:** render the returned `whatsappShareUrl` as an anchor inside the success toast (or a small
"Open WhatsApp" confirmation step) instead of calling `window.open` from an async continuation.

---

## 4. Medium — data quality and UX defects

- **D1. Every RLS denial in `lib/dal.ts` is swallowed.** The `catch {}` at `lib/dal.ts:81` is what hid
  B2 for as long as it has been hidden. Log to `console.error` with a stable prefix; still never throw.
- **D2. Repository errors are thrown, not returned.** `TeamPersistenceError` propagates out of the
  server actions into React's error boundary, so an RLS denial renders `error.tsx`'s generic
  "Could not load the team directory" instead of the actionable message the dialogs are built to
  display. Catch `TeamPersistenceError` in each action and map it to `{ ok: false, error }`.
- **D3. Activity feed prints the actor's name twice.** `activity-security-tab.tsx` renders
  `{event.actorName} {event.message}`, but every `message` built in `team-repository.ts` already
  starts with the actor ("Invited by X as ADMIN.", "X changed the role from…"). `ACTIVITY_EVENT_COPY`
  in `team-copy.ts` is a third, entirely unused, phrasing of the same thing. Pick one and delete the
  others.
- **D4. "Save Role Change" is the label on the button that *opens* the dialog** —
  `access-permissions-tab.tsx:35`. Should read "Change Role".
- **D5. Hydration mismatch on the security card.** `activity-security-tab.tsx` calls
  `formatLastActive(member, new Date().toISOString())` during render of a Client Component; every
  other surface threads the server's `nowIso` down. Pass `nowIso` in as a prop.
- **D6. Job Title is collectable nowhere.** `inviteStaffSchema` accepts `jobTitle`; the invite dialog
  hardcodes `jobTitle: undefined` and renders no field, yet the profile header falls back to it
  (`team-member-detail.tsx` `subTitle`). Add the field to the dialog and the edit sheet.
- **D7. `completedThisWeekCount` filters on `due_at`, not a completion timestamp.**
  `loadStaffProfile()` counts `status = COMPLETE and due_at >= startOfWeek`, so a task completed today
  but due last month is not counted, and one completed months ago but due this week is. Use a
  completion timestamp if `departure_group_tasks` has one; otherwise rename the card to
  "Completed, due this week" so the label matches the query.
- **D8. Week boundary uses the server's local timezone.** `startOfWeek` in `loadStaffProfile()` uses
  `new Date()` / `setHours`, while the rest of the app uses `colomboDayKey()` from `lib/date`.
- **D9. `matchesTeamFilters` ignores `filters.lastActive` for every value except `NEEDS_REVIEW`,**
  yet `activeFilterCount()` counts it — the chip can show "1 filter" while filtering nothing.
- **D10. `assignGroupToStaff` does not check role compatibility.** Any staff member can be made
  `PRIMARY_GUIDE`, including someone whose role is `FINANCE`; `filterGroupsForRole()` will then hand
  them a guide's scope. Validate responsibility against role, or at minimum warn in the dialog.
- **D11. `BACKUP_GUIDE` cache column is lossy by design** — `cacheColumnsFor()` writes a single
  `backup_guide_name` for a many-to-many responsibility. Either stop caching it and read
  `staff_group_assignments`, or state the "most recent wins" behaviour in the dialog.
- **D12. CSV inconsistency.** `teamToCsv` exports the raw `lastActiveAt` ISO string while
  `accessAuditToCsv` exports the humanised `formatLastActive`. Use the ISO date in both.
- **D13. `deactivateStaff` leaves group assignments live** — deliberate (build plan D15) — but nothing
  in the UI flags a deactivated owner on a Departure Group, which was the other half of that decision.
  Add the flag, or drop the claim from the dialog copy.

---

## 5. Low — polish

- `roles-permissions-sheet.tsx` calls `describeRoleAccess(role)` inside the render loop for all seven
  roles on every interaction; memoise or hoist.
- `TeamList` recreates `columns` when `sort` changes (correct), but `notReady` is redefined every
  render and captured in that memo's closure without being a dependency — harmless today, a
  stale-closure trap once those handlers do real work.
- `KpiRow` is a four-column grid and Team renders five cards, so the fifth wraps. The build plan calls
  this intentional; worth re-checking against the current design.
- `loading.tsx` skeleton does not match the rendered layout (no KPI row).
- `error.tsx` surfaces `error.message` verbatim, which for a `TeamPersistenceError` leaks table and
  operation names to the browser. Show a generic message; keep the detail in the server log.

---

## 6. Implementation phases

Ordered so each phase leaves the module strictly better than the last, and so the "can't create users"
report is resolved by the end of Phase 1.

### Phase 1 — Make invitation work end to end *(fixes B1–B4, C1, H1)*

1. New migration `supabase/migrations/2026XXXX_team_invitation_repair.sql`:
   - `public.touch_own_activity()` — security definer, keys off `auth.uid()`, writes only
     `last_active_at` / `activated_at` and `INVITED → ACTIVE`.
   - `public.accept_own_invitation()` — security definer, `PENDING → ACCEPTED` on the caller's rows.
   - `public.create_staff_invitation(...)` — security definer, one transaction:
     `staff_profiles` + `staff_invitations` + `agency_members`; asserts the caller is an `ADMIN` of
     the target agency.
   - Trigger `staff_profiles_sync_agency_membership` mirroring `role` / `status` onto `agency_members`.
   - `enforce_last_admin()` gains `and agency_id = old.agency_id`.
   - `revoke all from public; grant execute to authenticated` on each new function.
2. `lib/data/team-repository.ts`
   - `inviteStaff`: call `create_staff_invitation`; on any failure after `inviteUserByEmail`, call
     `admin.auth.admin.deleteUser(staffId)`; adopt orphaned auth users on `email_exists`.
   - Both `redirectTo` values → `/auth/confirm?next=%2Flogin%3Fmode%3Dsetup`.
   - `revokeInvitation`: delete the auth user when the profile never left `INVITED`.
3. `lib/dal.ts` — `touchLastActive` calls the two RPCs; log failures instead of swallowing them.
4. `app/(auth)/login/page.tsx` + `login-form.tsx` — handle `mode=setup`.
5. `app/(auth)/README.md` — document the Invite email template and the redirect URL.

**Exit criteria:** invite an `OPERATIONS` user against a clean database → email arrives → link sets a
password → they sign in → `staff_profiles.status = ACTIVE`, `staff_invitations.status = ACCEPTED`,
`agency_members.status = ACTIVE`, and `/management/team` redirects them to their own profile. Repeat
for `GUIDE` and `ADMIN`. Force a mid-invite failure and confirm the address is still invitable.

### Phase 2 — Finish the half-built features *(C2, C3, C4, C6, H2, H3, D6)*

1. `updateStaffProfile()` + `updateStaffProfileAction` + `edit-profile-sheet.tsx`, wired from both the
   list row menu and the profile header.
2. Render `ChangeRoleDialog` from `TeamList`.
3. "Extend Access" in the profile overflow menu and as a row action for lapsed accounts.
4. Branch becomes a per-agency picker writing `branch_id` + the `branch` snapshot; add the Job Title
   field to the invite dialog and the edit sheet.
5. Invite dialog: reactivation path when the email matches a `DEACTIVATED` profile.

**Exit criteria:** no `notReady(...)` call remains anywhere in the Team module.

### Phase 3 — Correctness and audit trail *(C5, C7, H4, H5, H6, H7, D1–D5, D7–D9)*

Error mapping in actions, `access_starts_on` enforcement, read-time invitation expiry, the seasonal
extend fix, the duplicated-actor-name cleanup, `nowIso` threading, `colomboDayKey()` for week
boundaries, WhatsApp channel validation, and the WhatsApp link as an anchor.

### Phase 4 — Hardening and polish *(D10–D13, §5)*

Role/responsibility compatibility on assignment, deactivated-owner flagging on Departure Groups, CSV
consistency, and the UI polish items.

---

## 7. Verification plan

No test harness exists in this repo (`package.json` has `lint` and `typecheck` only), so verification
is manual plus SQL assertions. For each phase:

```bash
npm run typecheck && npm run lint
```

**Invite matrix** — run for `ADMIN`, `CEO`, `OPERATIONS`, `VISA`, `FINANCE`, `MARKETING`, `GUIDE`, and
for both `PERMANENT` and `SEASONAL`:

1. Invite → check `auth.users`, `staff_profiles`, `staff_invitations`, `agency_members` each have
   exactly one consistent row.
2. Accept the emailed link → set a password → sign in.
3. Assert `status = ACTIVE` on all three tables, and that the landing page matches the role's
   capability matrix in `lib/access/team-access.ts`.
4. Change role → assert `staff_profiles.role` and `agency_members.role` agree.
5. Deactivate → assert sign-in is refused and the assignment rows survive.
6. Reactivate → assert sign-in works again.

**Failure paths:** invite an existing address; invite → revoke → re-invite the same address; invite
with the profile insert forced to fail; demote or deactivate the last admin (must be refused, per
agency).

**Multi-tenant:** with two agencies seeded, confirm agency A's Team list never shows agency B's staff,
and that agency B having admins does not permit agency A's last admin to be demoted.

---

## 8. Explicitly out of scope

Per-user permission overrides (roles stay code-defined — build plan D9), HR fields (payroll, leave,
appraisals — build plan §13), a WhatsApp Business API integration (the `wa.me` deep link stays), and
self-serve cross-agency membership (multi-tenancy plan Phase 3).

---

## 9. Addendum — click-to-confirm (post-B1 follow-up)

B1's fix (routing the invite link through `/auth/confirm` instead of a bare `redirectTo`) is
necessary but was not sufficient on its own: `/auth/confirm` was still a plain `GET` route handler
that verified the token immediately on load. That is vulnerable to a real failure mode — Gmail's
phishing scanner, Outlook Safe Links, and most corporate mail-security gateways automatically fetch
links in incoming email to scan them, and since every Supabase auth token is single-use, an
automated GET can burn the token before the real person ever clicks. This was hit in practice on
this Team build (first-click invite reporting `otp_expired`).

Fixed by converting `/auth/confirm` from a route handler into a page that requires an actual button
click before calling `verifyOtp()` / `exchangeCodeForSession()` — see the "Click-to-confirm" section
of `app/(auth)/README.md` for the full explanation and the required email-template change (switching
every template from `{{ .ConfirmationURL }}` to the `{{ .TokenHash }}` form is now load-bearing, not
optional — a stock template still routes through Supabase's own `/auth/v1/verify` first, which this
app cannot protect). Applies to all three flows that use `/auth/confirm`: Team invitations, magic
link sign-in, and password reset.

**Follow-up found while verifying the above on a real project still using the stock template:** on a
Supabase project configured for the **implicit** Auth Flow Type, a successful `/auth/v1/verify` sends
the session back as `#access_token=...&refresh_token=...` in the URL **fragment**, which a Server
Component can never see — `/auth/confirm/page.tsx` was redirecting these to `link_invalid` even
though the invite had genuinely succeeded. `confirm-link-card.tsx` now also checks
`window.location.hash` for this shape and calls `setSession()` on the browser client directly. Also
discovered in the same pass: a live invite session's decoded JWT shows `amr: [{ method: "otp" }]`,
not `"invite"` as B1's original fix assumed — `hasRecentRecoveryAuth()` in `app/(auth)/actions.ts` now
checks for `"otp"` (with `"recovery"`/`"invite"` kept as a defensive fallback), or the Set Password
screen would have rejected a freshly-confirmed invite session as expired. See the "Click-to-confirm"
section of `app/(auth)/README.md` for the full detail — this fragment path is a compatibility
fallback only; it does not close the prefetch gap, which still requires the template switch.

---

## 10. Addendum — the invite session never reached Set Password, and status stayed INVITED

Two more bugs found end-to-end testing the confirm flow, both independent of everything above.

**B1-follow-up-2 — `proxy.ts` bounced a freshly-confirmed invitee straight to `/dashboard`.**
`confirm-link-card.tsx` correctly established a session and navigated to `next` (`/login?mode=setup`),
but `proxy.ts` redirects any already-authenticated user away from `/login` to `/dashboard` — with a
single carve-out for `mode=reset` (added for the password-recovery flow) that nobody extended to cover
`mode=setup`. The invitee's browser hit that redirect before `reset-password-dialog.tsx` ever
rendered, so "Set your password" was skipped entirely and they landed, still without a password set,
on the dashboard. Fixed: `proxy.ts`'s `isChoosingNewPassword` check now also matches `mode=setup`.

**New finding — `touch_own_activity()` (B2) is wired to the wrong trigger point.** It is only ever
called from `lib/dal.ts`'s `touchLastActive()`, which only runs inside `requireUser()` — and
`requireUser()` is called exclusively from Server Actions across this codebase (every `actions.ts`
file), never from a page render. `app/(main)/layout.tsx`, the layout wrapping every page under
`(main)` including the dashboard and the Team module, only called `getCurrentStaffRole()` (which
calls the read-only `getUser()`). The practical effect: a newly invited person who signs in and simply
*looks around* the app — without ever submitting a form — never triggers the `INVITED -> ACTIVE` flip
at all, and the Team list shows "Invited" forever regardless of how long they've actually been signed
in and using the product. Combined with the previous bug (which skipped the one screen most likely to
prompt a first genuine form submission), this made the stuck status very easy to hit. Fixed:
`app/(main)/layout.tsx` now calls `requireUser()` unconditionally, ahead of any role/capability gating
— the one place every authenticated page in `(main)` passes through.

**New finding — every UPDATE-only mutator reported false success on a silently blocked write.**
Supabase's `.update()` does not error when its `.eq()` filter (or an RLS `using` clause narrowing it
further) matches zero rows — it returns `{ data: null, error: null }`. None of `changeStaffRole()`,
`deactivateStaff()`, `reactivateStaff()`, `updateStaffProfile()`, or `extendSeasonalAccess()` checked
for that, so a write blocked by RLS (or a stale id) reported `{ ok: true }` back to the UI — "Role
updated" toast, `router.refresh()`, nothing in the row had actually changed — with no way for an
operator to tell a real success from a silent no-op. This is the most likely explanation for "changing
role / assigning permission did nothing." Fixed: a new `assertRowUpdated()` helper in
`lib/data/team-repository.ts` requires `.select("id").maybeSingle()` after every such UPDATE and turns
a null result into a thrown `TeamPersistenceError`, which `runTeamAction()` (D2) already converts into
an honest `{ ok: false }` instead of a false positive. `reactivateStaff()` needed restructuring first
(select-then-update) since it has a *legitimate* zero-row case — already-active — that must stay a
silent, idempotent success rather than trip the new check.

**Still open — "assigning groups didn't work" has no confirmed root cause.** `assign-group-dialog.tsx`
and `assignGroupAction`/`assignGroupToStaff()` are correctly wired (verified by fresh read, not
assumed); the responsibility-INSERT path already throws a real error on an RLS block (`.upsert().select().single()`
errors on zero rows, unlike a bare `.update()`). The likely explanation is `loadAssignableDepartureGroups()`
returning zero rows in whatever environment this was tested against — the dialog shows "No open
Departure Groups" and the Assign button stays disabled, which reads as "didn't work" with no visible
error. Needs confirmation: what did the dialog actually show when this was tried — an empty group
picker, a disabled button, or an error toast after clicking Assign with a group selected?

---

## 11. Addendum — the actual root cause of the stuck INVITED status, and a Strict-Mode bug in the confirm card

Live server logs from testing the fixes above surfaced two more real bugs, superseding part of §10's
analysis.

**The real root cause of "status only showing Invited": `cookies()` called inside `after()`.**
`touchLastActive()` in `lib/dal.ts` called `createClient(await cookies())` *inside* its `after()`
callback. Next.js throws on this — `cookies()` must be resolved before `after()` runs and passed in,
not awaited inside it — and the resulting error was caught by the function's own `try/catch` and only
ever logged, never surfaced anywhere a person would see it. In practice this meant
`touch_own_activity()` / `accept_own_invitation()` had **never run a single time**, for any user, since
this code was first written — predating every fix in this document. §10's `app/(main)/layout.tsx` fix
(calling `requireUser()` on every page) is what made this fire on every request instead of only
occasionally, which is what finally surfaced it in the logs. Fixed: `requireUser()` now resolves
`cookies()` itself and passes the resolved store into `touchLastActive(userId, cookieStore)` as a
parameter; the `after()` callback only ever reads that closed-over value.

**A new bug found in the same testing pass — React Strict Mode double-invoking `confirm-link-card.tsx`'s
effect.** That effect's very first action is `window.history.replaceState(...)`, clearing the URL
fragment — non-idempotent by design (see §9/§10, the fragment must not sit in the visible URL). Strict
Mode (dev only) intentionally runs every effect twice on mount to catch exactly this class of bug: the
first run correctly found the session tokens, set `phase = "ready-implicit"`, and cleared the
fragment; the second run found the fragment already empty and overwrote that correct state with "That
link is missing its confirmation code," a fraction of a second later — reproducing reliably on every
real invite link. Fixed with a `useRef` guard (`fragmentProcessed`) so only the first invocation's
result can ever take effect, regardless of how many times Strict Mode re-runs the effect.

**Assign Departure Group — still unconfirmed**, now blocked behind retesting the whole flow with these
two fixes in place. Once the invite → set-password → activation path is confirmed working end to end,
retry this and paste the exact error text.
