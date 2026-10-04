"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { capabilitiesForSuppliers } from "@/lib/access/suppliers-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import {
  addSupplierNote,
  attachCommitmentEvidence,
  confirmCommitment,
  createCommitment,
  createSupplier,
  loadGroupLinkableEntities,
  recordSupplierPayment,
  recordSupplierRefund,
  setSupplierReliability,
  updateCommitmentStatus,
  upsertSupplierContact,
  upsertSupplierService,
  type GroupLinkableEntity,
  type SupplierActor,
} from "@/lib/data/suppliers-repository";
import { requireUser } from "@/lib/dal";
import {
  addSupplierNoteSchema,
  attachCommitmentEvidenceSchema,
  confirmCommitmentSchema,
  createCommitmentSchema,
  createSupplierSchema,
  recordSupplierPaymentSchema,
  recordSupplierRefundSchema,
  setReliabilitySchema,
  toSupplierFieldErrors,
  updateCommitmentStatusSchema,
  upsertContactSchema,
  upsertSupplierServiceSchema,
} from "@/lib/validations/suppliers";
import { createClient } from "@/utils/supabase/server";

export interface SupplierActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

async function db() {
  return createClient(await cookies());
}

function revalidateSuppliers(supplierId?: string, departureGroupId?: string) {
  revalidatePath("/suppliers");
  if (supplierId) revalidatePath(`/suppliers/${supplierId}`);
  revalidatePath("/operations");
  if (departureGroupId) revalidatePath(`/departure-groups/${departureGroupId}`);
}

async function currentActor(): Promise<{ actor: SupplierActor; role: Awaited<ReturnType<typeof getCurrentStaffRole>>["role"] }> {
  const user = await requireUser();
  const { role, name } = await getCurrentStaffRole();
  return { actor: { id: user.id, name: name ?? "Staff" }, role };
}

/* ── Supplier ─────────────────────────────────────────────────────────────── */

export interface CreateSupplierResult extends SupplierActionResult {
  supplierId?: string;
}

export async function createSupplierAction(input: unknown): Promise<CreateSupplierResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.createSupplier) return { ok: false, error: "Your role cannot add suppliers." };

  const parsed = createSupplierSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSupplierFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await createSupplier(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateSuppliers(result.id);
  return { ok: true, supplierId: result.id };
}

/* ── Bulk import ──────────────────────────────────────────────────────────── */

export interface SupplierImportRowResult {
  rowNumber: number;
  supplierCode: string;
  ok: boolean;
  supplierId?: string;
  error?: string;
}

export type ImportSuppliersResult =
  | { ok: true; created: number; total: number; results: SupplierImportRowResult[] }
  | { ok: false; error: string };

/**
 * Creates many suppliers from parsed spreadsheet rows in one call.
 *
 * The client has already mapped and previewed the rows, but this re-validates
 * every one — a Server Action cannot trust its input. Supplier-code uniqueness
 * is enforced by the database (`createSupplier` translates the `23505`
 * conflict into a friendly error), so an in-file duplicate simply fails on its
 * second occurrence while every other valid row still gets created.
 */
export async function importSuppliersAction(input: unknown): Promise<ImportSuppliersResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.createSupplier || !can.importExport) {
    return { ok: false, error: "Your role cannot import suppliers." };
  }

  if (!Array.isArray(input)) {
    return { ok: false, error: "No rows were received to import." };
  }
  if (input.length === 0) {
    return { ok: false, error: "There are no valid rows to import." };
  }
  if (input.length > 200) {
    return { ok: false, error: "Import is limited to 200 suppliers at a time." };
  }

  const supabase = await db();
  const results: SupplierImportRowResult[] = [];
  let created = 0;

  for (let i = 0; i < input.length; i++) {
    const rowNumber = i + 1;
    const row = input[i] as { supplierCode?: unknown } | null | undefined;
    const parsed = createSupplierSchema.safeParse(input[i]);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "This row is not valid.";
      results.push({
        rowNumber,
        supplierCode: typeof row?.supplierCode === "string" ? row.supplierCode : "—",
        ok: false,
        error: firstError,
      });
      continue;
    }

    const result = await createSupplier(supabase, parsed.data, actor);
    if (!result.ok) {
      results.push({
        rowNumber,
        supplierCode: parsed.data.supplierCode,
        ok: false,
        error: result.error,
      });
      continue;
    }

    created++;
    results.push({
      rowNumber,
      supplierCode: parsed.data.supplierCode,
      ok: true,
      supplierId: result.id,
    });
  }

  if (created > 0) revalidateSuppliers();
  return { ok: true, created, total: input.length, results };
}

export async function setReliabilityAction(input: unknown): Promise<SupplierActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.setReliability) return { ok: false, error: "Your role cannot set supplier reliability." };

  const parsed = setReliabilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toSupplierFieldErrors(parsed.error) };

  const supabase = await db();
  const result = await setSupplierReliability(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateSuppliers(parsed.data.supplierId);
  return { ok: true };
}

export async function upsertContactAction(input: unknown): Promise<SupplierActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.manageContacts) return { ok: false, error: "Your role cannot manage supplier contacts." };

  const parsed = upsertContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toSupplierFieldErrors(parsed.error) };

  const supabase = await db();
  const result = await upsertSupplierContact(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateSuppliers(parsed.data.supplierId);
  return { ok: true };
}

export async function upsertServiceAction(input: unknown): Promise<SupplierActionResult> {
  const { role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.viewCosts) return { ok: false, error: "Your role cannot manage services and rates." };

  const parsed = upsertSupplierServiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toSupplierFieldErrors(parsed.error) };

  const supabase = await db();
  const result = await upsertSupplierService(supabase, parsed.data);
  if (!result.ok) return result;

  revalidateSuppliers(parsed.data.supplierId);
  return { ok: true };
}

export async function addSupplierNoteAction(input: unknown): Promise<SupplierActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.editSupplier) return { ok: false, error: "Your role cannot add notes." };

  const parsed = addSupplierNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a note." };

  const supabase = await db();
  const result = await addSupplierNote(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateSuppliers(parsed.data.supplierId);
  return { ok: true };
}

/* ── Commitments ──────────────────────────────────────────────────────────── */

export interface CreateCommitmentResult extends SupplierActionResult {
  commitmentId?: string;
}

export type ListGroupLinkableEntitiesResult =
  | { ok: true; accommodations: GroupLinkableEntity[]; transports: GroupLinkableEntity[] }
  | { ok: false; error: string };

/** Options for "Create Commitment"'s "Link to" picker — see `loadGroupLinkableEntities()`. */
export async function listGroupLinkableEntitiesAction(departureGroupId: string): Promise<ListGroupLinkableEntitiesResult> {
  const { role } = await currentActor();
  if (!capabilitiesForSuppliers(role).viewModule) {
    return { ok: false, error: "Your role cannot view suppliers." };
  }
  const supabase = await db();
  const { accommodations, transports } = await loadGroupLinkableEntities(supabase, departureGroupId);
  return { ok: true, accommodations, transports };
}

export async function createCommitmentAction(input: unknown): Promise<CreateCommitmentResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.createCommitment) return { ok: false, error: "Your role cannot create supplier commitments." };

  const parsed = createCommitmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: toSupplierFieldErrors(parsed.error) };
  }

  const supabase = await db();
  const result = await createCommitment(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateSuppliers(parsed.data.supplierId, parsed.data.departureGroupId);
  return { ok: true, commitmentId: result.id };
}

export async function updateCommitmentStatusAction(input: unknown): Promise<SupplierActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.requestCommitment && !can.disputeCommitment) {
    return { ok: false, error: "Your role cannot update commitment status." };
  }

  const parsed = updateCommitmentStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (parsed.data.status === "DISPUTED" && !can.disputeCommitment) {
    return { ok: false, error: "Your role cannot dispute a commitment." };
  }

  const supabase = await db();
  const result = await updateCommitmentStatus(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateSuppliers();
  return { ok: true };
}

export async function confirmCommitmentAction(input: unknown): Promise<SupplierActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.confirmCommitment) return { ok: false, error: "Your role cannot confirm supplier commitments." };

  const parsed = confirmCommitmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const result = await confirmCommitment(supabase, parsed.data.commitmentId, actor);
  if (!result.ok) return result;

  revalidateSuppliers();
  return { ok: true };
}

export async function attachCommitmentEvidenceAction(input: unknown): Promise<SupplierActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.uploadEvidence) return { ok: false, error: "Your role cannot upload evidence." };

  const parsed = attachCommitmentEvidenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await db();
  const result = await attachCommitmentEvidence(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateSuppliers();
  return { ok: true };
}

export async function recordSupplierPaymentAction(input: unknown): Promise<SupplierActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.recordPayment) return { ok: false, error: "Your role cannot record supplier payments." };

  const parsed = recordSupplierPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toSupplierFieldErrors(parsed.error) };

  const supabase = await db();
  const result = await recordSupplierPayment(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateSuppliers();
  return { ok: true };
}

/**
 * Records a refund a supplier sent back to the agency — e.g. a hotel
 * commitment cancelled after a deposit was already paid. Gated on the same
 * `recordPayment` capability as `recordSupplierPaymentAction`, since this is
 * the same ledger, just money moving the other way.
 */
export async function recordSupplierRefundAction(input: unknown): Promise<SupplierActionResult> {
  const { actor, role } = await currentActor();
  const can = capabilitiesForSuppliers(role);
  if (!can.recordPayment) return { ok: false, error: "Your role cannot record supplier refunds." };

  const parsed = recordSupplierRefundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request.", fieldErrors: toSupplierFieldErrors(parsed.error) };

  const supabase = await db();
  const result = await recordSupplierRefund(supabase, parsed.data, actor);
  if (!result.ok) return result;

  revalidateSuppliers();
  return { ok: true };
}
