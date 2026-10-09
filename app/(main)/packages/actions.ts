"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/dal";
import { canRoleViewPackage, capabilitiesForPackages } from "@/lib/access/packages-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { listPendingPackageChanges } from "@/lib/data/packages-repository";
import { createClient } from "@/utils/supabase/server";

import { changesToContent, computePackageChanges } from "@/lib/packages/change-diff";

import { formDataToDraftRow, rowToFormData } from "./create-package/mappers";
import { describePackageWriteFailure } from "./package-write-errors";
import { crossFieldIssues, isStepValid } from "./create-package/schemas";
import { packageFormSchema, toPackageFormData } from "./create-package/server-schema";

/**
 * Mutations for package templates.
 *
 * Server Actions are public POST endpoints, so each one re-authenticates with
 * `requireUser()`, re-checks the acting role's capability
 * (`lib/access/packages-access.ts`), and re-validates its payload rather than
 * trusting that the UI gated the call.
 */

export type SavePackageResult =
  /** Saved: a draft, or a live package whose changes were display-only or nothing. */
  | { ok: true; kind: "SAVED"; packageId: string; savedAt: string }
  /** A live package's payment/contract/booking changes were applied at once (approval is switched off for them) and recorded. */
  | { ok: true; kind: "APPLIED"; packageId: string; savedAt: string; appliedColumns: string[] }
  /** Display-only changes were saved; the rest waits for an administrator's approval. */
  | { ok: true; kind: "PENDING"; packageId: string; savedAt: string; requestId: string; appliedColumns: string[]; pendingColumns: string[] }
  | { ok: false; error: string; step?: number; code?: "STALE" | "PENDING_EXISTS" };

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
  return { error: describePackageWriteFailure(error).error };
}

const idSchema = z.uuid();

const savePackageInput = z.object({
  packageId: idSchema.nullable().optional(),
  form: packageFormSchema,
  /** The `updated_at` the client last saw. Required for an existing package: a stale write is refused rather than silently clobbered. */
  expectedUpdatedAt: z.string().max(64).optional(),
  /** Why a payment/contract/booking change is being made. Required by the database when the change touches them. */
  reason: z.string().trim().max(500).optional(),
  /** Replace the change already waiting for approval for this package. */
  supersedePending: z.boolean().optional(),
});

const archiveOptionsSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  force: z.boolean().optional(),
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

  if (error) return { ok: false, error: describePackageWriteFailure(error).error };
  if (!row) return { ok: false, error: "That package no longer exists." };
  if (!canRoleViewPackage(row.status, gate.role, row.owner_id, gate.user.id)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  return { ok: true, row };
}

/**
 * Saves a package. Nothing in the wizard saves on its own: this runs only when the person presses Save draft or Save changes (TASK-043).
 *
 * - No `packageId`: creates a Draft owned by the caller.
 * - A Draft: writes only the columns that changed, refusing a stale write.
 * - Open for Sale / Sales Closed: display-only changes save at once; payment, contract and booking changes go through `submit_package_change`
 *   (reason required, then approval or immediate recorded application, depending on the agency's switches). The database recomputes the difference and
 *   enforces all of it; this action only decides what to send.
 * - Archived: refused.
 *
 * Tolerant on purpose for drafts: an incomplete package is a legitimate draft. It never changes `status` or `featured`.
 */
export async function savePackageAction(input: unknown): Promise<SavePackageResult> {
  const gate = await requirePackageCapability("savePackage", (can) => can.createPackage || can.editPackage);
  if (!gate.ok) return { ok: false, error: gate.error };

  const parsed = savePackageInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That package data could not be read." };
  }

  const form = toPackageFormData(parsed.data.form);
  const supabase = createClient(await cookies());

  if (!parsed.data.packageId) {
    if (!gate.can.createPackage) return { ok: false, error: "You do not have permission to do that." };

    const { data, error } = await supabase
      .from("packages")
      .insert({ ...formDataToDraftRow(form), status: "Draft", featured: false, owner_id: gate.user.id })
      .select("id, updated_at")
      .single();

    if (error) {
      return { ok: false, ...describePackageWriteFailure(error, { internalCode: form.internalCode }) };
    }
    revalidatePath("/packages");
    return { ok: true, kind: "SAVED", packageId: data.id, savedAt: data.updated_at };
  }

  if (!gate.can.editPackage) return { ok: false, error: "You do not have permission to do that." };
  if (!parsed.data.expectedUpdatedAt) {
    return { ok: false, code: "STALE", error: "This package changed elsewhere. Reload and try again." };
  }

  const { data: current, error: readError } = await supabase
    .from("packages")
    .select("*")
    .eq("id", parsed.data.packageId)
    .maybeSingle();
  if (readError) return { ok: false, error: describePackageWriteFailure(readError).error };
  if (!current) return { ok: false, error: "That package no longer exists." };
  if (!canRoleViewPackage(current.status, gate.role, current.owner_id, gate.user.id)) {
    return { ok: false, error: "You do not have permission to do that." };
  }
  if (current.status === "Archived") {
    return { ok: false, error: "An archived package cannot be edited. Restore it first." };
  }
  if (current.updated_at !== parsed.data.expectedUpdatedAt) {
    return { ok: false, code: "STALE", error: "This package changed elsewhere. Reload and try again." };
  }

  const changes = computePackageChanges(rowToFormData(current), form);
  if (changes.length === 0) {
    return { ok: true, kind: "SAVED", packageId: current.id, savedAt: current.updated_at };
  }
  const content = changesToContent(changes);

  if (current.status === "Draft") {
    const { data, error } = await supabase
      .from("packages")
      .update(content)
      .eq("id", current.id)
      .eq("updated_at", current.updated_at)
      .select("id, updated_at")
      .maybeSingle();

    if (error) {
      return { ok: false, ...describePackageWriteFailure(error, { internalCode: form.internalCode }) };
    }
    if (!data) {
      return { ok: false, code: "STALE", error: "This package changed elsewhere. Reload and try again." };
    }
    revalidatePath("/packages");
    revalidatePath(`/packages/${data.id}`);
    return { ok: true, kind: "SAVED", packageId: data.id, savedAt: data.updated_at };
  }

  // On sale: the database function sorts the changes into tiers, enforces the capability, the reason and the approval switches.
  const { data: result, error: rpcError } = await supabase.rpc("submit_package_change", {
    p_package_id: current.id,
    p_content: content,
    p_expected_updated_at: current.updated_at,
    p_reason: parsed.data.reason ?? null,
    p_supersede: parsed.data.supersedePending === true,
  });

  if (rpcError) {
    if (rpcError.code === "23505") {
      return { ok: false, ...describePackageWriteFailure(rpcError, { internalCode: form.internalCode }) };
    }
    if (/already waiting for approval/i.test(rpcError.message)) {
      return { ok: false, code: "PENDING_EXISTS", error: "Another change is already waiting for approval for this package." };
    }
    return { ok: false, ...mapLifecycleRpcError(rpcError) };
  }

  const outcome = result as {
    status?: string;
    request_id?: string | null;
    applied_columns?: string[];
    pending_columns?: string[];
  } | null;

  const { data: fresh } = await supabase.from("packages").select("updated_at").eq("id", current.id).maybeSingle();
  const savedAt = fresh?.updated_at ?? current.updated_at;

  revalidatePath("/packages");
  revalidatePath(`/packages/${current.id}`);
  revalidatePath("/departure-groups");
  revalidatePath("/leads");

  const appliedColumns = outcome?.applied_columns ?? [];
  const pendingColumns = outcome?.pending_columns ?? [];
  if (outcome?.status === "PENDING" && outcome.request_id) {
    return { ok: true, kind: "PENDING", packageId: current.id, savedAt, requestId: outcome.request_id, appliedColumns, pendingColumns };
  }
  if (outcome?.status === "APPLIED") {
    return { ok: true, kind: "APPLIED", packageId: current.id, savedAt, appliedColumns };
  }
  return { ok: true, kind: "SAVED", packageId: current.id, savedAt };
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
  }

  // The whole publish — role and agency check, row lock, stale-write compare,
  // the content write, the Draft/Sales Closed -> Open for Sale transition, the
  // activity-log entry and the version — happens in one database transaction
  // (`publish_package_with_content`, TASK-043 PKG-01/PKG-05). The database,
  // not this action, decides which transition is legal from the row's REAL
  // status, so a stale or forged `form.status` cannot matter. Only the
  // draft-safe columns are sent: `status`, `featured` and every lifecycle
  // column are never part of the content, so a publish cannot set `featured`.
  const { data, error } = await supabase.rpc("publish_package_with_content", {
    p_package_id: parsed.data.packageId ?? null,
    p_content: formDataToDraftRow(form),
    p_expected_updated_at: parsed.data.expectedUpdatedAt ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        ...describePackageWriteFailure(error, { internalCode: form.internalCode }),
      };
    }
    return { ok: false, ...mapLifecycleRpcError(error) };
  }

  const publishedId = (data as { id: string } | null)?.id;
  if (!publishedId) {
    return { ok: false, error: "This package could not be published. Please try again." };
  }

  revalidatePath("/packages");
  revalidatePath(`/packages/${publishedId}`);
  // Both the Departure Groups create flow's template picker and the Leads
  // module's quoting catalogue (`loadLeadPackages()`) only offer Open for
  // Sale packages — without this, a package published here keeps showing
  // as unavailable there until something else happens to revalidate those
  // routes. See docs/modules/packages-production-readiness-plan.md, finding F3.
  revalidatePath("/departure-groups");
  revalidatePath("/leads");
  return { ok: true, packageId: publishedId };
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

  // The version is recorded inside publish_package, in the same transaction.

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
      /** The package's real status, so the wizard knows whether a save is a draft save or a reviewed change. */
      status: string;
      /** Whether this person may change payment and booking terms of a package that is on sale. */
      canEditSensitiveTerms: boolean;
      /** A change already waiting for approval, if any. */
      pendingChange: { id: string; requestedByName: string; createdAt: string; columns: string[] } | null;
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

  const pending = (await listPendingPackageChanges(row.id))[0] ?? null;

  return {
    ok: true,
    formData: rowToFormData(row),
    updatedAt: row.updated_at ?? null,
    liveGroupCount: usage?.live_group_count ?? 0,
    status: row.status,
    canEditSensitiveTerms: gate.can.editSensitiveTerms,
    pendingChange: pending
      ? { id: pending.id, requestedByName: pending.requestedByName, createdAt: pending.createdAt, columns: Object.keys(pending.changes) }
      : null,
  };
}

const checkCodeInput = z.object({
  code: z.string().trim().min(1).max(64),
  /** The package being edited, so its own saved code is not reported as taken. */
  packageId: idSchema.nullable().optional(),
});

export type PackageCodeCheckResult =
  | { ok: true; available: true }
  | { ok: true; available: false; suggestion: string }
  | { ok: false; error: string };

/**
 * Tells the wizard's Package Code field whether a code is free in the caller's
 * agency, and if not, the next free `CODE-2`, `CODE-3`, ... It mirrors the
 * `packages_internal_code_agency_unique` index (case-insensitive, per agency),
 * but the index remains the authority: this is only an early, friendly warning,
 * and the save/publish actions still translate a race into the same message.
 */
export async function checkPackageCodeAction(input: unknown): Promise<PackageCodeCheckResult> {
  const gate = await requirePackageCapability(
    "createPackage",
    (can) => can.createPackage || can.editPackage,
  );
  if (!gate.ok) return { ok: false, error: gate.error };

  const parsed = checkCodeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a package code first." };

  const { code, packageId } = parsed.data;
  const likeEscaped = code.replace(/[\\%_]/g, (character) => `\\${character}`);

  // Row-level security already scopes this to the caller's agency.
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("packages")
    .select("id, internal_code")
    .ilike("internal_code", `${likeEscaped}%`)
    .limit(200);
  if (error) return { ok: false, error: describePackageWriteFailure(error).error };

  const taken = new Set(
    (data ?? [])
      .filter((row) => row.id !== packageId)
      .map((row) => row.internal_code.trim().toLowerCase()),
  );
  if (!taken.has(code.toLowerCase())) return { ok: true, available: true };

  for (let suffix = 2; suffix <= 200; suffix++) {
    const candidate = `${code}-${suffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      return { ok: true, available: false, suggestion: candidate };
    }
  }
  return { ok: true, available: false, suggestion: `${code}-${Date.now().toString(36).toUpperCase()}` };
}

export type NextPackageCodeResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/**
 * Picks the next unused `PKG-<year>-NNNN` code in the caller's agency for the
 * wizard's read-only Package Code field. Like `checkPackageCodeAction`, it is an
 * early answer only: the unique index stays the authority if two people race.
 */
export async function getNextPackageCodeAction(): Promise<NextPackageCodeResult> {
  const gate = await requirePackageCapability(
    "createPackage",
    (can) => can.createPackage || can.editPackage,
  );
  if (!gate.ok) return { ok: false, error: gate.error };

  const prefix = `PKG-${new Date().getFullYear()}-`;
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("packages")
    .select("internal_code")
    .ilike("internal_code", `${prefix}%`)
    .limit(5000);
  if (error) return { ok: false, error: describePackageWriteFailure(error).error };

  const taken = new Set((data ?? []).map((row) => row.internal_code.trim().toLowerCase()));
  let highestNumber = 0;
  for (const usedCode of taken) {
    const match = /^pkg-\d{4}-(\d+)$/.exec(usedCode);
    if (match) highestNumber = Math.max(highestNumber, Number(match[1]));
  }

  let nextNumber = highestNumber + 1;
  let candidate = `${prefix}${String(nextNumber).padStart(4, "0")}`;
  while (taken.has(candidate.toLowerCase())) {
    nextNumber += 1;
    candidate = `${prefix}${String(nextNumber).padStart(4, "0")}`;
  }
  return { ok: true, code: candidate };
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
  if (typeof featured !== "boolean") return { ok: false, error: "Choose featured or not featured." };

  const supabase = createClient(await cookies());
  const access = await requirePackageRow(parsedId.data, gate, supabase);
  if (!access.ok) return { ok: false, error: access.error };

  const { data, error } = await supabase
    .from("packages")
    .update({ featured })
    .eq("id", parsedId.data)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: describePackageWriteFailure(error).error };
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
  const parsedOptions = archiveOptionsSchema.safeParse(options ?? {});
  if (!parsedOptions.success) return { ok: false, error: "The archive reason could not be read." };
  options = parsedOptions.data;

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

  if (readError) return { ok: false, error: describePackageWriteFailure(readError).error };
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
    if (!isCodeCollision) return { ok: false, error: describePackageWriteFailure(error).error };
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
    return { ok: false, error: describePackageWriteFailure(error).error };
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

/* ── Reviewed changes to a live package (TASK-043) ───────────────────────── */

export type PackageChangeDecisionResult =
  | { ok: true; status: "APPROVED" | "REJECTED" | "WITHDRAWN" | "EXPIRED" }
  | { ok: false; error: string; code?: "STALE" };

const decideChangeInput = z.object({
  requestId: idSchema,
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

/** Approve or reject another person's pending change. The database refuses your own request, an expired or already-decided one, and a package that has changed since. */
export async function decidePackageChangeAction(input: unknown): Promise<PackageChangeDecisionResult> {
  const gate = await requirePackageCapability("approvePackageChanges", (can) => can.approvePackageChanges);
  if (!gate.ok) return { ok: false, error: gate.error };

  const parsed = decideChangeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That decision could not be read." };

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("decide_package_change", {
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { ok: false, ...mapLifecycleRpcError(error) };

  revalidatePath("/packages");
  revalidatePath("/departure-groups");
  revalidatePath("/leads");
  const status = (data as { status?: string } | null)?.status;
  if (status === "APPROVED" || status === "REJECTED" || status === "EXPIRED") return { ok: true, status };
  return { ok: false, error: "The decision could not be recorded. Please try again." };
}

const withdrawChangeInput = z.object({
  requestId: idSchema,
  note: z.string().trim().max(500).optional(),
});

/** Cancel a pending change: the requester, or an approver. */
export async function withdrawPackageChangeAction(input: unknown): Promise<PackageChangeDecisionResult> {
  const gate = await requirePackageCapability("withdrawPackageChange", (can) => can.editPackage || can.approvePackageChanges);
  if (!gate.ok) return { ok: false, error: gate.error };

  const parsed = withdrawChangeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That request could not be read." };

  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("withdraw_package_change", {
    p_request_id: parsed.data.requestId,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { ok: false, ...mapLifecycleRpcError(error) };

  revalidatePath("/packages");
  return { ok: true, status: "WITHDRAWN" };
}

export type PackageApprovalPolicyResult =
  | { ok: true; moneyAndContract: boolean; bookingsAndOperations: boolean }
  | { ok: false; error: string };

/** Whether each tier of change currently needs a second person's approval, so the comparison dialog can say what will happen. Defaults to "needs approval". */
export async function getPackageApprovalPolicyAction(): Promise<PackageApprovalPolicyResult> {
  const gate = await requirePackageCapability("viewPackageApprovalPolicy", (can) => can.viewModule);
  if (!gate.ok) return { ok: false, error: gate.error };

  const { agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: true, moneyAndContract: true, bookingsAndOperations: true };

  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("agency_settings")
    .select("package_approval_money_contract, package_approval_bookings_ops")
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (error) return { ok: true, moneyAndContract: true, bookingsAndOperations: true };

  return {
    ok: true,
    moneyAndContract: data?.package_approval_money_contract ?? true,
    bookingsAndOperations: data?.package_approval_bookings_ops ?? true,
  };
}
