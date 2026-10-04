"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/dal";
import { canRoleViewPackage, capabilitiesForPackages } from "@/lib/access/packages-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createClient } from "@/utils/supabase/server";

import { formDataToDraftRow, formDataToRow, rowToFormData } from "./create-package/mappers";
import { crossFieldIssues, isStepValid } from "./create-package/schemas";
import {
  packageFormPatchSchema,
  packageFormSchema,
  toPackageFormData,
} from "./create-package/server-schema";

/**
 * Mutations for package templates.
 *
 * Server Actions are public POST endpoints, so each one re-authenticates with
 * `requireUser()`, re-checks the acting role's capability
 * (`lib/access/packages-access.ts`), and re-validates its payload rather than
 * trusting that the UI gated the call.
 */

export type SaveDraftResult =
  | { ok: true; packageId: string; savedAt: string }
  | { ok: false; error: string; code?: "STALE" };

export type PublishResult =
  | { ok: true; packageId: string }
  | { ok: false; error: string; step?: number; code?: "STALE" };

export type PackageActionResult =
  | { ok: true; packageId: string }
  | { ok: false; error: string; code?: "STALE" };

/**
 * `archivePackageAction`'s own result — `LIVE_GROUPS` is not a failure the
 * caller should just show as an error toast: it carries `liveGroupCount` so
 * the UI can offer the force-archive-with-a-reason path instead
 * (ADMIN-only; see `archive_package()` in
 * supabase/migrations/20261006090000_packages_lifecycle_phase1.sql).
 */
export type ArchivePackageResult =
  | { ok: true; packageId: string }
  | { ok: false; error: string; code?: "STALE" }
  | { ok: false; error: string; code: "LIVE_GROUPS"; liveGroupCount: number };

/**
 * Every lifecycle mutation below goes through one of the five SECURITY
 * DEFINER RPCs in that same migration — `packages.status` no longer changes
 * via a plain `.update()` anywhere in this file. The RPCs are the actual
 * enforcement of which FROM/TO transitions are legal (see finding B2); this
 * helper only translates a Postgres error raised there into the same
 * `{ ok: false, code, error }` shape every other write in this module uses.
 * `40001` is this codebase's established convention for "someone else wrote
 * first, retry" (see `concurrencyConflictMessage()` in
 * lib/data/departure-groups-repository.ts) — every other error the RPCs
 * raise already carries a complete, friendly `message`.
 */
function mapLifecycleRpcError(error: { code?: string; message: string }): {
  code?: "STALE";
  error: string;
} {
  if (error.code === "40001") {
    return {
      code: "STALE",
      error: error.message || "This package changed elsewhere. Reload and try again.",
    };
  }
  return { error: error.message || "That action could not be completed." };
}

/**
 * Records a publish as an immutable `package_versions` row, best-effort —
 * see `package_versions_create()` in
 * supabase/migrations/20261007090000_packages_versioning_and_snapshot.sql.
 * By the time this is called the actual publish (the status transition,
 * and for `publishPackageAction` the content write too) has already
 * succeeded, so a failure here is a lesser degradation — a missing history
 * entry, not a broken publish — and is logged rather than surfaced as a
 * publish failure to the caller.
 */
async function createPackageVersionBestEffort(
  supabase: ReturnType<typeof createClient>,
  packageId: string,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.rpc("package_versions_create", {
    p_package_id: packageId,
    p_snapshot: snapshot,
  });
  if (error) {
    console.error(
      `[packages] could not record a version for ${packageId} after publish: ${error.message}`,
    );
  }
}

const idSchema = z.uuid();

const saveDraftInput = z.object({
  packageId: idSchema.nullable().optional(),
  form: packageFormSchema,
});

const savePatchInput = z.object({
  packageId: idSchema,
  patch: packageFormPatchSchema,
  /** The `updated_at` the client last saw — a stale write is refused rather than silently clobbered. */
  expectedUpdatedAt: z.string().optional(),
});

const publishInput = z.object({
  packageId: idSchema.nullable().optional(),
  form: packageFormSchema,
  /** The `updated_at` the client last saw — see the compare-and-swap write below. */
  expectedUpdatedAt: z.string().optional(),
});

const STEP_TITLES = [
  "Commercial Identity",
  "Sales Offer & Pricing",
  "Journey Template",
  "Service Standards",
  "Traveller Requirements",
  "Group Creation Defaults",
];

/**
 * `can` merges a custom role's saved overrides (Management → Roles &
 * Permissions, `role_permissions` for the "packages" module) over the
 * built-in default for the caller's base role — not the hardcoded default
 * alone. Before this, `capabilitiesForPackages(role)` was called directly
 * everywhere in this module, so anything an ADMIN configured for a custom
 * role in the Roles & Permissions editor had no effect at all on Packages:
 * every custom role was silently stuck with its base role's hardcoded
 * capabilities (finding A4 in docs/modules/packages-production-readiness-plan.md).
 */
async function requirePackageCapability<K extends string>(
  key: K,
  check: (can: ReturnType<typeof capabilitiesForPackages>) => boolean,
) {
  const user = await requireUser();
  const { role, roleId } = await getCurrentStaffRole();
  const supabase = createClient(await cookies());
  const can = await loadDynamicCapabilities(
    supabase,
    roleId,
    "packages",
    capabilitiesForPackages(role),
  );
  if (!check(can)) {
    return { ok: false as const, error: "You do not have permission to do that." };
  }
  return { ok: true as const, user, role, can };
}

/**
 * Object-level check to run alongside the module-level capability gate
 * above. `requirePackageCapability()` only answers "can this role touch
 * packages at all" — it says nothing about *this* package, so on its own it
 * let MARKETING (whose real rule is "own drafts or Open for Sale", enforced
 * by `canRoleViewPackage`) publish, unpublish, feature, archive, restore or
 * duplicate *any* package, including another user's draft, because most
 * mutations never fetched the row to check. See
 * docs/modules/packages-production-readiness-plan.md, finding A5.
 *
 * Fetches a narrow projection and runs `canRoleViewPackage`. Callers that
 * already select the full row for their own purposes (publish-existing,
 * duplicate, get-for-edit) should run `canRoleViewPackage` inline against
 * that row instead of calling this a second time.
 */
async function requirePackageRow(
  packageId: string,
  gate: { role: Awaited<ReturnType<typeof getCurrentStaffRole>>["role"]; user: { id: string } },
  supabase: ReturnType<typeof createClient>,
): Promise<
  | {
      ok: true;
      row: { id: string; status: string; owner_id: string | null; updated_at: string };
    }
  | { ok: false; error: string }
> {
  // `updated_at` is fetched here too so every lifecycle action can pass it
  // straight to its RPC as `p_expected_updated_at` — this read and that
  // write happen within the same request, so it is always the freshest
  // value the server has seen, giving every list-menu lifecycle action
  // optimistic-concurrency protection for free, with no client cooperation
  // required (unlike the wizard's publish, which genuinely needs the
  // client's own last-seen value — see `publishPackageAction`).
  const { data: row, error } = await supabase
    .from("packages")
    .select("id, status, owner_id, updated_at")
    .eq("id", packageId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "That package no longer exists." };
  if (!canRoleViewPackage(row.status, gate.role, row.owner_id, gate.user.id)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  return { ok: true, row };
}

/**
 * Creates or updates a draft. Called by autosave, so it is deliberately
 * tolerant: an incomplete package is a legitimate draft. It never publishes —
 * `status` is forced to a non-published value when creating.
 */
export async function saveDraftAction(input: unknown): Promise<SaveDraftResult> {
  const parsed = saveDraftInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That package data could not be read." };
  }

  const form = toPackageFormData(parsed.data.form);
  // Draft autosave never writes `status`/`featured` — see
  // `formDataToDraftRow()` and finding A1 in
  // docs/modules/packages-production-readiness-plan.md.
  const row = formDataToDraftRow(form);
  const supabase = createClient(await cookies());

  if (parsed.data.packageId) {
    const gate = await requirePackageCapability("editPackage", (can) => can.editPackage);
    if (!gate.ok) return { ok: false, error: gate.error };

    const { data: current, error: currentError } = await supabase
      .from("packages")
      .select("status, owner_id")
      .eq("id", parsed.data.packageId)
      .maybeSingle();
    if (currentError) return { ok: false, error: currentError.message };
    if (!current) return { ok: false, error: "That package no longer exists." };
    if (!canRoleViewPackage(current.status, gate.role, current.owner_id, gate.user.id)) {
      return { ok: false, error: "You do not have permission to do that." };
    }

    const { data, error } = await supabase
      .from("packages")
      .update(row)
      .eq("id", parsed.data.packageId)
      .select("id, updated_at")
      .maybeSingle();

    if (error) {
      return { ok: false, error: error.message };
    }
    if (!data) {
      return { ok: false, error: "That package no longer exists." };
    }

    return { ok: true, packageId: data.id, savedAt: data.updated_at };
  }

  const gate = await requirePackageCapability("createPackage", (can) => can.createPackage);
  if (!gate.ok) return { ok: false, error: gate.error };

  // `status`/`featured` are forced here, not read off the client's form —
  // see finding A1.
  const { data, error } = await supabase
    .from("packages")
    .insert({ ...row, status: "Draft", featured: false, owner_id: gate.user.id })
    .select("id, updated_at")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, packageId: data.id, savedAt: data.updated_at };
}

/**
 * Patch autosave: the client sends only the form keys it changed; this loads
 * the current row, merges the patch onto it, and writes only the columns
 * whose *value* actually changed — not merely the columns that happen to
 * share a name with a changed form field, which would be one typo away from
 * silently writing the wrong column. The extra read this costs is far
 * cheaper than the ~120-column full-row write autosave used to do on every
 * flush.
 *
 * Refuses the write (`code: "STALE"`) if another tab has written to the row
 * since the client's `expectedUpdatedAt`, instead of silently clobbering it.
 */
export async function savePackagePatchAction(
  input: unknown,
): Promise<SaveDraftResult> {
  const gate = await requirePackageCapability("editPackage", (can) => can.editPackage);
  if (!gate.ok) return { ok: false, error: gate.error };

  const parsed = savePatchInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That package data could not be read." };
  }

  const supabase = createClient(await cookies());
  const { data: currentRow, error: readError } = await supabase
    .from("packages")
    .select("*")
    .eq("id", parsed.data.packageId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!currentRow) return { ok: false, error: "That package no longer exists." };
  if (!canRoleViewPackage(currentRow.status, gate.role, currentRow.owner_id, gate.user.id)) {
    return { ok: false, error: "You do not have permission to do that." };
  }

  if (
    parsed.data.expectedUpdatedAt &&
    currentRow.updated_at !== parsed.data.expectedUpdatedAt
  ) {
    return {
      ok: false,
      code: "STALE",
      error: "This draft changed in another tab. Reload to continue.",
    };
  }

  if (Object.keys(parsed.data.patch).length === 0) {
    return { ok: true, packageId: currentRow.id, savedAt: currentRow.updated_at };
  }

  const currentForm = rowToFormData(currentRow);
  const mergedForm = { ...currentForm, ...parsed.data.patch } as typeof currentForm;
  const newRow = formDataToRow(mergedForm);

  const rowPatch: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(newRow)) {
    // Lifecycle columns are never writable through patch autosave — the
    // patch schema already strips them (`packageFormPatchSchema`), but this
    // loop iterates every column `formDataToRow()` produces regardless of
    // what the patch contained, so it is guarded again here as a second,
    // independent line of defence. See finding A1.
    if (column === "status" || column === "featured") continue;
    const before = JSON.stringify((currentRow as Record<string, unknown>)[column]);
    const after = JSON.stringify(value);
    if (before !== after) rowPatch[column] = value;
  }

  if (Object.keys(rowPatch).length === 0) {
    return { ok: true, packageId: currentRow.id, savedAt: currentRow.updated_at };
  }

  const { data, error } = await supabase
    .from("packages")
    .update(rowPatch)
    .eq("id", parsed.data.packageId)
    .eq("updated_at", currentRow.updated_at)
    .select("id, updated_at")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) {
    return {
      ok: false,
      code: "STALE",
      error: "This draft changed in another tab. Reload to continue.",
    };
  }

  return { ok: true, packageId: data.id, savedAt: data.updated_at };
}

/**
 * Publishes a package. Unlike the draft path this re-runs every step's
 * validation server-side, so a caller cannot POST an incomplete package
 * straight to "Open for Sale".
 */
export async function publishPackageAction(
  input: unknown,
): Promise<PublishResult> {
  const gate = await requirePackageCapability("publishPackage", (can) => can.publishPackage);
  if (!gate.ok) return { ok: false, error: gate.error };

  const parsed = publishInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That package data could not be read." };
  }

  const form = toPackageFormData(parsed.data.form);

  for (let step = 1; step <= 6; step++) {
    if (!isStepValid(step, form)) {
      return {
        ok: false,
        step,
        error: `Step ${step} (${STEP_TITLES[step - 1]}) is incomplete.`,
      };
    }
  }

  // Rules that compare fields across two different steps (finding B6) —
  // every individual step can report itself complete while still
  // disagreeing with another step's fields (e.g. Makkah + Madinah nights
  // exceeding the package's total nights), so this runs once every step has
  // already passed on its own.
  const crossIssues = crossFieldIssues(form);
  if (crossIssues.length > 0) {
    return { ok: false, error: crossIssues[0] };
  }

  const supabase = createClient(await cookies());

  if (parsed.data.packageId) {
    const access = await requirePackageRow(parsed.data.packageId, gate, supabase);
    if (!access.ok) return { ok: false, error: access.error };

    // The target status is always 'Open for Sale', and the transition is
    // only legal from the row's REAL, database status — never from
    // `form.status`, which is client-supplied and can be stale or simply
    // wrong (the form only flips to "Open for Sale" locally *after* a
    // publish already succeeded — see create-package-wizard.tsx). Trusting
    // it here used to let this action "publish" an Archived or Sales
    // Closed package by just keeping whatever `form.status` already said,
    // which also kept re-stamping `published_at` on every such save. This
    // is the same FROM-state rule `publish_package()` (the RPC used by
    // `publishExistingPackageAction` below) enforces — see finding B2 in
    // docs/modules/packages-production-readiness-plan.md.
    if (access.row.status !== "Draft" && access.row.status !== "Sales Closed") {
      return {
        ok: false,
        error: `This package is ${access.row.status} and cannot be published from here.`,
      };
    }

    // This action writes the wizard's full form body AND flips the
    // lifecycle status in one statement — unlike `publishExistingPackageAction`
    // (which has no in-flight form content, only a status change, so it
    // goes through the `publish_package` RPC), so it cannot cleanly go
    // through that RPC without splitting the write in two. It still gets
    // the same compare-and-swap protection the RPC gives every other
    // lifecycle write: refuse rather than silently clobber a row that
    // changed since the browser last saw it (finding B7).
    if (
      parsed.data.expectedUpdatedAt &&
      access.row.updated_at !== parsed.data.expectedUpdatedAt
    ) {
      return {
        ok: false,
        code: "STALE",
        error: "This package changed elsewhere. Reload and try again.",
      };
    }

    const row = {
      ...formDataToRow(form),
      status: "Open for Sale" as const,
      previous_status: access.row.status,
      published_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("packages")
      .update(row)
      .eq("id", parsed.data.packageId)
      .eq("updated_at", access.row.updated_at)
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!data) {
      return {
        ok: false,
        code: "STALE",
        error: "This package changed elsewhere. Reload and try again.",
      };
    }

    await createPackageVersionBestEffort(supabase, data.id, row);

    revalidatePath("/packages");
    revalidatePath(`/packages/${data.id}`);
    // Both the Departure Groups create flow's template picker and the Leads
    // module's quoting catalogue (`loadLeadPackages()`) only offer Open for
    // Sale packages — without this, a package published here keeps showing
    // as unavailable there until something else happens to revalidate those
    // routes. See docs/modules/packages-production-readiness-plan.md, finding F3.
    revalidatePath("/departure-groups");
    revalidatePath("/leads");
    return { ok: true, packageId: data.id };
  }

  // A brand-new package created straight through "Publish" (no draft row
  // existed yet) has no earlier status worth preserving — it is always
  // created directly as Open for Sale, regardless of whatever `form.status`
  // says.
  const row = {
    ...formDataToRow(form),
    status: "Open for Sale" as const,
    previous_status: "Draft",
    published_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("packages")
    .insert({ ...row, owner_id: gate.user.id })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await createPackageVersionBestEffort(supabase, data.id, { ...row, owner_id: gate.user.id });

  revalidatePath("/packages");
  revalidatePath("/departure-groups");
  revalidatePath("/leads");
  return { ok: true, packageId: data.id };
}

/** Publish for an already-saved package straight from the list — used by the row menu. */
export async function publishExistingPackageAction(
  packageId: string,
): Promise<PackageActionResult> {
  const gate = await requirePackageCapability("publishPackage", (can) => can.publishPackage);
  if (!gate.ok) return gate;

  const parsedId = idSchema.safeParse(packageId);
  if (!parsedId.success) return { ok: false, error: "Invalid package reference." };

  const supabase = createClient(await cookies());
  const { data: row, error: readError } = await supabase
    .from("packages")
    .select("*")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (readError || !row) return { ok: false, error: "That package no longer exists." };
  if (!canRoleViewPackage(row.status, gate.role, row.owner_id, gate.user.id)) {
    return { ok: false, error: "You do not have permission to do that." };
  }

  const form = rowToFormData(row);
  for (let step = 1; step <= 6; step++) {
    if (!isStepValid(step, form)) {
      return {
        ok: false,
        error: `Cannot publish — step ${step} (${STEP_TITLES[step - 1]}) is incomplete.`,
      };
    }
  }
  const crossIssues = crossFieldIssues(form);
  if (crossIssues.length > 0) {
    return { ok: false, error: `Cannot publish — ${crossIssues[0]}` };
  }

  // The freshly-read `row.updated_at` above doubles as the optimistic-
  // concurrency guard — this read and this write are the same request, so
  // it is always the newest value the server has seen.
  const { error } = await supabase.rpc("publish_package", {
    p_package_id: parsedId.data,
    p_expected_updated_at: row.updated_at,
  });
  if (error) return { ok: false, ...mapLifecycleRpcError(error) };

  // `row` predates the transition, so its `status` is stamped over — this
  // is what was actually published, not what the row said a moment ago.
  await createPackageVersionBestEffort(supabase, parsedId.data, {
    ...row,
    status: "Open for Sale",
  });

  revalidatePath("/packages");
  revalidatePath(`/packages/${parsedId.data}`);
  revalidatePath("/departure-groups");
  revalidatePath("/leads");
  return { ok: true, packageId: parsedId.data };
}

export type GetPackageForEditResult =
  | {
      ok: true;
      formData: ReturnType<typeof rowToFormData>;
      updatedAt: string | null;
      liveGroupCount: number;
    }
  | { ok: false; error: string };

/**
 * Loads an existing package as wizard form data, for the edit dialog opened
 * straight from the list — the list only holds the narrow `PackageListItem`
 * projection, not the ~120 wizard columns, so this fetches the full row on
 * demand instead.
 */
export async function getPackageForEditAction(
  packageId: string,
): Promise<GetPackageForEditResult> {
  const gate = await requirePackageCapability("editPackage", (can) => can.editPackage);
  if (!gate.ok) return gate;

  const parsedId = idSchema.safeParse(packageId);
  if (!parsedId.success) return { ok: false, error: "Invalid package reference." };

  const supabase = createClient(await cookies());
  const [{ data: row, error }, { data: usage }] = await Promise.all([
    supabase.from("packages").select("*").eq("id", parsedId.data).maybeSingle(),
    supabase
      .from("package_usage")
      .select("live_group_count")
      .eq("package_id", parsedId.data)
      .maybeSingle(),
  ]);

  if (error || !row) return { ok: false, error: "That package no longer exists." };
  if (!canRoleViewPackage(row.status, gate.role, row.owner_id, gate.user.id)) {
    return { ok: false, error: "You do not have permission to do that." };
  }

  return {
    ok: true,
    formData: rowToFormData(row),
    updatedAt: row.updated_at ?? null,
    liveGroupCount: usage?.live_group_count ?? 0,
  };
}

/** Open for Sale -> Sales Closed. */
export async function unpublishPackageAction(
  packageId: string,
): Promise<PackageActionResult> {
  const gate = await requirePackageCapability("publishPackage", (can) => can.publishPackage);
  if (!gate.ok) return gate;

  const parsedId = idSchema.safeParse(packageId);
  if (!parsedId.success) return { ok: false, error: "Invalid package reference." };

  const supabase = createClient(await cookies());
  const access = await requirePackageRow(parsedId.data, gate, supabase);
  if (!access.ok) return { ok: false, error: access.error };

  const { error } = await supabase.rpc("close_package_sales", {
    p_package_id: parsedId.data,
    p_expected_updated_at: access.row.updated_at,
  });
  if (error) return { ok: false, ...mapLifecycleRpcError(error) };

  revalidatePath("/packages");
  revalidatePath(`/packages/${parsedId.data}`);
  revalidatePath("/departure-groups");
  revalidatePath("/leads");
  return { ok: true, packageId: parsedId.data };
}

/**
 * Sales Closed -> Open for Sale. Previously there was no way back to Open
 * for Sale once a package's sales were closed (finding E5) — this is the
 * missing return path.
 */
export async function reopenPackageAction(
  packageId: string,
): Promise<PackageActionResult> {
  const gate = await requirePackageCapability("publishPackage", (can) => can.publishPackage);
  if (!gate.ok) return gate;

  const parsedId = idSchema.safeParse(packageId);
  if (!parsedId.success) return { ok: false, error: "Invalid package reference." };

  const supabase = createClient(await cookies());
  // A full-row read, not `requirePackageRow()` — a Sales Closed package can
  // still be edited (ADMIN/OPERATIONS keep `editPackage` regardless of
  // status), so its content needs the same re-validation `publish_package`
  // gets before it is legal to reopen for sale again.
  const { data: row, error: readError } = await supabase
    .from("packages")
    .select("*")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (readError || !row) return { ok: false, error: "That package no longer exists." };
  if (!canRoleViewPackage(row.status, gate.role, row.owner_id, gate.user.id)) {
    return { ok: false, error: "You do not have permission to do that." };
  }

  const form = rowToFormData(row);
  for (let step = 1; step <= 6; step++) {
    if (!isStepValid(step, form)) {
      return {
        ok: false,
        error: `Cannot reopen — step ${step} (${STEP_TITLES[step - 1]}) is incomplete.`,
      };
    }
  }
  const crossIssues = crossFieldIssues(form);
  if (crossIssues.length > 0) {
    return { ok: false, error: `Cannot reopen — ${crossIssues[0]}` };
  }

  const { error } = await supabase.rpc("reopen_package", {
    p_package_id: parsedId.data,
    p_expected_updated_at: row.updated_at,
  });
  if (error) return { ok: false, ...mapLifecycleRpcError(error) };

  revalidatePath("/packages");
  revalidatePath(`/packages/${parsedId.data}`);
  revalidatePath("/departure-groups");
  revalidatePath("/leads");
  return { ok: true, packageId: parsedId.data };
}

export async function setPackageFeaturedAction(
  packageId: string,
  featured: boolean,
): Promise<PackageActionResult> {
  const gate = await requirePackageCapability("toggleFeatured", (can) => can.toggleFeatured);
  if (!gate.ok) return gate;

  const parsedId = idSchema.safeParse(packageId);
  if (!parsedId.success) return { ok: false, error: "Invalid package reference." };

  const supabase = createClient(await cookies());
  const access = await requirePackageRow(parsedId.data, gate, supabase);
  if (!access.ok) return { ok: false, error: access.error };

  const { data, error } = await supabase
    .from("packages")
    .update({ featured })
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That package no longer exists." };

  revalidatePath("/packages");
  return { ok: true, packageId: data.id };
}

/**
 * Archives a package. Unlike delete, this is always reversible — the row
 * stays, `archived_at` is stamped, and it drops out of the default list
 * views into the Archived view.
 *
 * Refused when the package still has live departure groups, unless
 * `options.force` — which additionally requires ADMIN and a non-empty
 * `options.reason` — because archiving used to silently pull a package out
 * from under groups that were still actively selling off it, with no
 * warning at all (finding B3). The live-group count is checked here first,
 * before ever calling the RPC, so the UI can react to `code: "LIVE_GROUPS"`
 * by offering the force-archive-with-a-reason flow instead of a plain error
 * toast; `archive_package()` re-checks the same guard itself as the
 * authoritative backstop against a group being created in the gap between
 * this check and the write.
 */
export async function archivePackageAction(
  packageId: string,
  options?: { reason?: string; force?: boolean },
): Promise<ArchivePackageResult> {
  const gate = await requirePackageCapability(
    "archiveOrRestorePackage",
    (can) => can.archiveOrRestorePackage,
  );
  if (!gate.ok) return gate;

  const parsedId = idSchema.safeParse(packageId);
  if (!parsedId.success) return { ok: false, error: "Invalid package reference." };

  const supabase = createClient(await cookies());
  const access = await requirePackageRow(parsedId.data, gate, supabase);
  if (!access.ok) return { ok: false, error: access.error };

  const { data: usage } = await supabase
    .from("package_usage")
    .select("live_group_count")
    .eq("package_id", parsedId.data)
    .maybeSingle();
  const liveGroupCount = usage?.live_group_count ?? 0;

  if (liveGroupCount > 0 && !options?.force) {
    return {
      ok: false,
      code: "LIVE_GROUPS",
      liveGroupCount,
      error: `This package has ${liveGroupCount} live departure group${
        liveGroupCount === 1 ? "" : "s"
      }. Close sales instead, or force-archive with a reason.`,
    };
  }
  if (liveGroupCount > 0 && options?.force) {
    if (gate.role !== "ADMIN") {
      return {
        ok: false,
        error: "Only an administrator can archive a package that still has live departure groups.",
      };
    }
    if (!options.reason || !options.reason.trim()) {
      return {
        ok: false,
        error: "A reason is required to archive a package that still has live departure groups.",
      };
    }
  }

  const { error } = await supabase.rpc("archive_package", {
    p_package_id: parsedId.data,
    p_expected_updated_at: access.row.updated_at,
    p_reason: options?.reason?.trim() || null,
    p_force: !!options?.force,
  });
  if (error) return { ok: false, ...mapLifecycleRpcError(error) };

  revalidatePath("/packages");
  revalidatePath("/departure-groups");
  revalidatePath("/leads");
  return { ok: true, packageId: parsedId.data };
}

/**
 * Archived -> whatever status the package held immediately before it was
 * archived, via `previous_status` (falls back to Draft only when that is
 * unknown). Previously this always forced Draft regardless of what had
 * actually been archived — an Open for Sale package restored as a Draft
 * silently lost its sellable status (finding B2).
 */
export async function restorePackageAction(
  packageId: string,
): Promise<PackageActionResult> {
  const gate = await requirePackageCapability(
    "archiveOrRestorePackage",
    (can) => can.archiveOrRestorePackage,
  );
  if (!gate.ok) return gate;

  const parsedId = idSchema.safeParse(packageId);
  if (!parsedId.success) return { ok: false, error: "Invalid package reference." };

  const supabase = createClient(await cookies());
  const access = await requirePackageRow(parsedId.data, gate, supabase);
  if (!access.ok) return { ok: false, error: access.error };

  const { error } = await supabase.rpc("restore_package", {
    p_package_id: parsedId.data,
    p_expected_updated_at: access.row.updated_at,
  });
  if (error) return { ok: false, ...mapLifecycleRpcError(error) };

  revalidatePath("/packages");
  revalidatePath("/departure-groups");
  revalidatePath("/leads");
  return { ok: true, packageId: parsedId.data };
}

/** Clones every column except identity/bookkeeping ones; the copy always lands as a Draft. */
export async function duplicatePackageAction(
  packageId: string,
): Promise<PackageActionResult> {
  const gate = await requirePackageCapability(
    "duplicatePackage",
    (can) => can.duplicatePackage,
  );
  if (!gate.ok) return gate;

  const parsedId = idSchema.safeParse(packageId);
  if (!parsedId.success) return { ok: false, error: "Invalid package reference." };

  const supabase = createClient(await cookies());
  const { data: source, error: readError } = await supabase
    .from("packages")
    .select("*")
    .eq("id", parsedId.data)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!source) return { ok: false, error: "That package no longer exists." };
  if (!canRoleViewPackage(source.status, gate.role, source.owner_id, gate.user.id)) {
    return { ok: false, error: "You do not have permission to do that." };
  }

  const {
    id,
    owner_id,
    created_at,
    updated_at,
    published_at,
    itinerary_days,
    payment_milestones_count,
    transport_requirements_count,
    inclusions_count,
    exclusions_count,
    included_services_count,
    document_requirements_count,
    group_readiness_checklist_count,
    archived_at,
    duplicated_from,
    previous_status,
    published_version_id,
    ...copyable
  } = source as Record<string, unknown>;
  void id;
  void owner_id;
  void created_at;
  void updated_at;
  void published_at;
  void itinerary_days;
  void payment_milestones_count;
  void transport_requirements_count;
  void inclusions_count;
  void exclusions_count;
  void included_services_count;
  void document_requirements_count;
  void group_readiness_checklist_count;
  void archived_at;
  void duplicated_from;
  void previous_status;
  void published_version_id;

  // `internal_code` is now unique per agency
  // (packages_internal_code_agency_unique, see
  // supabase/migrations/20261006090000_packages_lifecycle_phase1.sql) — a
  // second duplicate of the same package would previously collide with the
  // first duplicate's identical "…-COPY" code (finding B4). `-COPY`, then
  // `-COPY-2`, `-COPY-3`, ... is tried until one is free.
  const baseCode = `${copyable.internal_code as string}-COPY`;
  const baseTitle = `${copyable.title as string} (Copy)`;

  for (let attempt = 1; attempt <= 25; attempt++) {
    const internalCode = attempt === 1 ? baseCode : `${baseCode}-${attempt}`;
    const { data, error } = await supabase
      .from("packages")
      .insert({
        ...copyable,
        title: baseTitle,
        internal_code: internalCode,
        status: "Draft",
        featured: false,
        owner_id: gate.user.id,
        duplicated_from: parsedId.data,
      })
      .select("id")
      .single();

    if (!error) {
      revalidatePath("/packages");
      return { ok: true, packageId: data.id };
    }

    const isCodeCollision =
      error.code === "23505" && error.message.includes("packages_internal_code_agency_unique");
    if (!isCodeCollision) return { ok: false, error: error.message };
    // Otherwise: that code is taken, loop and try the next suffix.
  }

  return {
    ok: false,
    error: "Could not find a free package code for the copy. Rename the source package's code and try again.",
  };
}

export async function deletePackageAction(
  packageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requirePackageCapability("deletePackage", (can) => can.deletePackage);
  if (!gate.ok) return gate;

  const parsed = idSchema.safeParse(packageId);
  if (!parsed.success) {
    return { ok: false, error: "Invalid package reference." };
  }

  const supabase = createClient(await cookies());
  const access = await requirePackageRow(parsed.data, gate, supabase);
  if (!access.ok) return { ok: false, error: access.error };

  // A package with any departure group built from it cannot be deleted —
  // the foreign key would refuse it anyway, but this returns a message that
  // names the actual blocker instead of a raw Postgres constraint error.
  const { data: usage } = await supabase
    .from("package_usage")
    .select("group_count")
    .eq("package_id", parsed.data)
    .maybeSingle();

  if (usage && usage.group_count > 0) {
    return {
      ok: false,
      error: `This package cannot be deleted — ${usage.group_count} departure group${
        usage.group_count === 1 ? " uses" : "s use"
      } it. Archive it instead, or move those groups off this template first.`,
    };
  }

  const { data, error } = await supabase
    .from("packages")
    .delete()
    .eq("id", parsed.data)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23503") {
      return {
        ok: false,
        error: "This package cannot be deleted — one or more departure groups still reference it.",
      };
    }
    return { ok: false, error: error.message };
  }

  if (!data) {
    return {
      ok: false,
      error: "That package no longer exists, or you cannot delete it.",
    };
  }

  revalidatePath("/packages");
  return { ok: true };
}
