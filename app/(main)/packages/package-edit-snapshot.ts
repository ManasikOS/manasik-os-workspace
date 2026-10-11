import { cookies } from "next/headers";
import { z } from "zod";

import { canRoleViewPackage } from "@/lib/access/packages-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { listPendingPackageChanges } from "@/lib/data/packages-repository";
import { createClient } from "@/utils/supabase/server";

import { rowToFormData } from "./create-package/mappers";

/**
 * Everything the package editor needs to start editing an existing package.
 *
 * Shared by `getPackageForEditAction` and the edit page so both read the
 * package the same way. It does not check the module capability — the caller
 * has already done that — but it does run the object-level view check, so a
 * role can never load a package it is not allowed to see.
 */
export interface PackageEditSnapshot {
  formData: ReturnType<typeof rowToFormData>;
  updatedAt: string | null;
  liveGroupCount: number;
  /** The package's real status, so the editor knows whether a save is a draft save or a reviewed change. */
  status: string;
  /** Whether this person may change payment and booking terms of a package that is on sale. */
  canEditSensitiveTerms: boolean;
  /** A change already waiting for approval, if any. */
  pendingChange: { id: string; requestedByName: string; createdAt: string; columns: string[] } | null;
}

export type LoadPackageEditSnapshotResult =
  | { ok: true; snapshot: PackageEditSnapshot }
  | { ok: false; error: string };

const packageIdSchema = z.uuid();

export async function loadPackageEditSnapshot(
  packageId: string,
  viewer: { role: StaffRole; userId: string; canEditSensitiveTerms: boolean },
): Promise<LoadPackageEditSnapshotResult> {
  const parsedId = packageIdSchema.safeParse(packageId);
  if (!parsedId.success) return { ok: false, error: "Invalid package reference." };

  const supabase = createClient(await cookies());
  const [{ data: row, error }, { data: usage }] = await Promise.all([
    supabase.from("packages").select("*").eq("id", parsedId.data).maybeSingle(),
    supabase.from("package_usage").select("live_group_count").eq("package_id", parsedId.data).maybeSingle(),
  ]);

  if (error || !row) return { ok: false, error: "That package no longer exists." };
  if (!canRoleViewPackage(row.status, viewer.role, row.owner_id, viewer.userId)) {
    return { ok: false, error: "You do not have permission to do that." };
  }

  const pending = (await listPendingPackageChanges(row.id))[0] ?? null;

  return {
    ok: true,
    snapshot: {
      formData: rowToFormData(row),
      updatedAt: row.updated_at ?? null,
      liveGroupCount: usage?.live_group_count ?? 0,
      status: row.status,
      canEditSensitiveTerms: viewer.canEditSensitiveTerms,
      pendingChange: pending
        ? { id: pending.id, requestedByName: pending.requestedByName, createdAt: pending.createdAt, columns: Object.keys(pending.changes) }
        : null,
    },
  };
}
