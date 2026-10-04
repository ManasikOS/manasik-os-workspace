"use server";

import { revalidatePath } from "next/cache";

import { capabilitiesForOperations } from "@/lib/access/operations-access";
import {
  autoAssignGroupRooms,
  bulkUpdateGroupTasks,
  createGroupTask,
  getCurrentStaffRole,
  markGroupAccommodationConfirmed,
  markGroupTransportConfirmed,
  reassignGroupTask,
  setGroupAccommodationReference,
  setGroupTransportReference,
  updateGroupTaskStatus,
} from "@/lib/data/departure-groups";
import { assignGroupToStaff, resolveStaffIdByName } from "@/lib/data/team-repository";
import { confirmLinkedCommitmentBestEffort, syncCommitmentForLinkedEntity } from "@/lib/data/suppliers-repository";
import { requireUser } from "@/lib/dal";
import {
  assignGuideSchema,
  bulkUpdateOperationsTasksSchema,
  confirmSupplierServiceSchema,
  createOperationsTaskSchema,
  reassignOperationsTaskSchema,
  recordSupplierDetailsSchema,
  toOperationsFieldErrors,
  updateOperationsTaskStatusSchema,
} from "@/lib/validations/operations";
import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";

export interface OperationsActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

function revalidateOperations() {
  revalidatePath("/operations");
}

async function currentCapabilities() {
  await requireUser();
  const { role } = await getCurrentStaffRole();
  return { role, can: capabilitiesForOperations(role) };
}

/* ── Tasks ────────────────────────────────────────────────────────────────── */

export async function createOperationsTaskAction(input: unknown): Promise<OperationsActionResult> {
  const { can } = await currentCapabilities();
  if (!can.createTask) return { ok: false, error: "Your role cannot create operational tasks." };

  const parsed = createOperationsTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid task.", fieldErrors: toOperationsFieldErrors(parsed.error) };
  }

  const ownerName = parsed.data.ownerName?.trim() ?? "";
  const ownerId = ownerName ? await resolveStaffIdByName(createClient(await cookies()), ownerName) : null;

  const result = await createGroupTask({
    departureGroupId: parsed.data.departureGroupId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    ownerName,
    ownerId,
    dueAt: parsed.data.dueAt,
    category: parsed.data.category,
    linkedReadinessItemId: parsed.data.linkedReadinessItemId ?? null,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidateOperations();
  return { ok: true };
}

export async function updateOperationsTaskStatusAction(input: unknown): Promise<OperationsActionResult> {
  const { can } = await currentCapabilities();
  if (!can.completeTask) return { ok: false, error: "Your role cannot update task status." };

  const parsed = updateOperationsTaskStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const result = await updateGroupTaskStatus(parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateOperations();
  return { ok: true };
}

export async function reassignOperationsTaskAction(input: unknown): Promise<OperationsActionResult> {
  const { can } = await currentCapabilities();
  if (!can.reassignTask) return { ok: false, error: "Your role cannot reassign tasks." };

  const parsed = reassignOperationsTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request.", fieldErrors: toOperationsFieldErrors(parsed.error) };
  }

  const ownerId = parsed.data.ownerName ? await resolveStaffIdByName(createClient(await cookies()), parsed.data.ownerName) : null;
  const result = await reassignGroupTask({ ...parsed.data, ownerId });
  if (!result.ok) return { ok: false, error: result.error };

  revalidateOperations();
  return { ok: true };
}

export async function bulkUpdateOperationsTasksAction(input: unknown): Promise<OperationsActionResult> {
  const { can } = await currentCapabilities();
  if (!can.bulkUpdateTasks) return { ok: false, error: "Your role cannot bulk-update tasks." };

  const parsed = bulkUpdateOperationsTasksSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const ownerId = parsed.data.ownerName ? await resolveStaffIdByName(createClient(await cookies()), parsed.data.ownerName) : null;
  const result = await bulkUpdateGroupTasks({
    taskRefs: parsed.data.taskIds,
    status: parsed.data.status,
    ownerName: parsed.data.ownerName,
    ownerId,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidateOperations();
  return { ok: true };
}

/* ── Supplier confirmations ──────────────────────────────────────────────── */

export async function recordSupplierDetailsAction(input: unknown): Promise<OperationsActionResult> {
  const user = await requireUser();
  const { can } = await currentCapabilities();
  if (!can.requestSupplier && !can.confirmSupplier) {
    return { ok: false, error: "Your role cannot edit supplier details." };
  }

  const parsed = recordSupplierDetailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request.", fieldErrors: toOperationsFieldErrors(parsed.error) };
  }

  const { id, departureGroupId, serviceKind, serviceLabel, supplierName, supplierId, bookingReference } = parsed.data;
  const result =
    serviceKind === "ACCOMMODATION"
      ? await setGroupAccommodationReference({ id, departureGroupId, supplierName, supplierId, bookingReference })
      : await setGroupTransportReference({ id, departureGroupId, supplierName, supplierId, bookingReference });
  if (!result.ok) return { ok: false, error: result.error };

  if (supplierId) {
    const { name } = await getCurrentStaffRole();
    try {
      const supabase = createClient(await cookies());
      await syncCommitmentForLinkedEntity(
        supabase,
        {
          supplierId,
          departureGroupId,
          linkedEntityType: serviceKind,
          linkedEntityId: id,
          serviceCategory: serviceKind === "ACCOMMODATION" ? "ACCOMMODATION_OTHER" : "OTHER",
          serviceLabel: serviceLabel ?? supplierName ?? "Supplier service",
        },
        { id: user.id, name: name ?? "Staff" },
      );
    } catch (error) {
      console.error(`[operations] failed to sync supplier commitment for ${serviceKind} ${id}:`, error);
    }
  }

  revalidateOperations();
  return { ok: true };
}

export async function confirmSupplierServiceAction(input: unknown): Promise<OperationsActionResult> {
  const user = await requireUser();
  const { can } = await currentCapabilities();
  if (!can.confirmSupplier) return { ok: false, error: "Your role cannot confirm supplier services." };

  const parsed = confirmSupplierServiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const { id, departureGroupId, serviceKind } = parsed.data;
  const result =
    serviceKind === "ACCOMMODATION"
      ? await markGroupAccommodationConfirmed({ id, departureGroupId })
      : await markGroupTransportConfirmed({ id, departureGroupId });
  if (!result.ok) return { ok: false, error: result.error };

  const { name } = await getCurrentStaffRole();
  try {
    const supabase = createClient(await cookies());
    await confirmLinkedCommitmentBestEffort(
      supabase,
      { linkedEntityType: serviceKind, linkedEntityId: id },
      { id: user.id, name: name ?? "Staff" },
    );
  } catch (error) {
    console.error(`[operations] failed to confirm linked commitment for ${serviceKind} ${id}:`, error);
  }

  revalidateOperations();
  return { ok: true };
}

/* ── Rooming ──────────────────────────────────────────────────────────────── */

export async function autoAssignRoomsAction(
  departureGroupId: string,
  accommodationId: string,
): Promise<OperationsActionResult> {
  const { can } = await currentCapabilities();
  if (!can.manageRooming) return { ok: false, error: "Your role cannot assign rooming." };

  const result = await autoAssignGroupRooms({ departureGroupId, accommodationId });
  if (!result.ok) return { ok: false, error: result.error };

  revalidateOperations();
  return { ok: true };
}

/* ── Guides ───────────────────────────────────────────────────────────────── */

export async function assignGuideAction(input: unknown): Promise<OperationsActionResult> {
  const { can } = await currentCapabilities();
  if (!can.assignGuide) return { ok: false, error: "Your role cannot assign guides." };

  const parsed = assignGuideSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid request.", fieldErrors: toOperationsFieldErrors(parsed.error) };
  }

  const user = await requireUser();
  const { name } = await getCurrentStaffRole();
  const supabase = createClient(await cookies());

  const result = await assignGroupToStaff(
    supabase,
    { staffId: parsed.data.staffId, departureGroupId: parsed.data.groupId, responsibility: "PRIMARY_GUIDE" },
    { id: user.id, name: name ?? "Staff" },
  );
  if (!result.ok) return { ok: false, error: result.error };

  revalidateOperations();
  return { ok: true };
}
