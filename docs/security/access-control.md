# Access Control Model

How roles, capabilities, and tenancy fit together, and what to do when a
new module or feature needs a new permission. Full historical design
context: [`docs/architecture/dynamic-roles-permissions-plan.md`](../architecture/dynamic-roles-permissions-plan.md).

## Model

- **Role** — `staff_profiles.role`, resolved server-side via
  `getCurrentStaffRole()` (`lib/data/departure-groups.ts`). This is the
  identity the rest of the app trusts; it is never read from the client.
- **Capability** — a named permission for one module/action, keyed in
  `lib/access/module-capability-keys.ts`.
- **Module defaults** — `lib/access/module-defaults.ts` maps each role to
  its default capability set per module.
- **Dynamic capabilities** — `lib/access/dynamic-capabilities.ts` layers
  agency-specific overrides on top of the defaults (an agency can grant or
  revoke a capability for a role without a code change).
- **Per-module access files** — `lib/access/<module>-access.ts` (e.g.
  `departure-groups-access.ts`, `finance-access.ts`, `pilgrims-access.ts`)
  expose the resolved, typed checks a page/component/action actually calls.

## Where enforcement happens (both, always)

1. **Application layer** — a Server Component or Server Action calls the
   relevant `lib/access/<module>-access.ts` function before rendering a
   control or performing a mutation. This drives what the *user sees*.
2. **Database layer** — an RLS policy on the underlying table(s) re-checks
   the same role/agency/capability logic. This is what actually protects
   the data if the application check is ever bypassed, buggy, or
   the query is ever called from a different code path.

Neither layer alone is sufficient. See
[`docs/security/security-guidelines.md`](security-guidelines.md).

## Adding a new capability

1. Add the key to `lib/access/module-capability-keys.ts`.
2. Set the default per role in `lib/access/module-defaults.ts` — default to
   the narrowest role set that makes the feature usable (least privilege).
3. Expose a typed check in the module's `lib/access/<module>-access.ts`.
4. Gate the UI (hide/disable the control) *and* the Server Action/Route
   Handler (reject the mutation) using that check — never one without the
   other.
5. Add or update the matching RLS policy so the database enforces the same
   rule independently.
6. If the capability should be agency-overridable, wire it through
   `dynamic-capabilities.ts` rather than hardcoding the default as final.

## Adding a new role

Only add a new role if an existing one genuinely can't be extended with a
capability override. New roles multiply the RLS policies and access-file
branches that need updating everywhere — prefer a new capability on an
existing role first.

## Tenancy interacts with access control

A capability check answers "can this role do X". Tenancy scoping answers
"X on which agency's data". Both apply on every read/write:
`staff_profiles.active_agency_id` (see `lib/tenancy.ts`) scopes the data,
the role/capability check scopes the action. A query missing either is a
bug.

## Testing access changes

- Add a test under `tests/<domain>/` for any new capability that gates a
  business-rule-bearing action (not for simple visibility toggles).
- Manually verify the RLS policy directly (e.g. via the Supabase MCP
  `get_advisors` / a scoped query) — a passing UI test with a mocked role
  does not prove the database itself enforces the boundary.
