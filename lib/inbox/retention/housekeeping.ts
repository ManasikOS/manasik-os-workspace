/**
 * A nightly clean-up that the per-agency retention sweep cannot do: staff files that were uploaded to the private bucket but never
 * sent (see the E1 migration). It is bounded per run so a large backlog is worked off over several nights instead of holding one
 * request open. (It used to also purge forwarded `inngest_outbox` rows; that table is gone, decision R9.)
 */

import "server-only";

import type { Db } from "@/lib/ai/db";
import { INBOX_ATTACHMENT_BUCKET } from "@/lib/inbox/attachments/staged-file";

export const ORPHAN_UPLOAD_MIN_AGE_HOURS = 24;
export const ORPHAN_UPLOAD_BATCH = 500;

export type HousekeepingResult = { orphanUploadsRemoved: number; failures: number };

/** Removes staged files that no message refers to. The list comes from the database; the files are removed through the Storage API. */
async function removeOrphanStagedUploads(db: Db): Promise<{ removed: number; failed: boolean }> {
  const { data, error } = await db.rpc("find_orphan_staged_uploads", { p_older_than_hours: ORPHAN_UPLOAD_MIN_AGE_HOURS, p_limit: ORPHAN_UPLOAD_BATCH });
  if (error) return { removed: 0, failed: true };
  const paths = ((data ?? []) as Array<{ name: string }>).map((row) => row.name).filter((name) => typeof name === "string" && name.length > 0);
  if (paths.length === 0) return { removed: 0, failed: false };
  const { data: removed, error: removeError } = await db.storage.from(INBOX_ATTACHMENT_BUCKET).remove(paths);
  if (removeError) return { removed: 0, failed: true };
  return { removed: (removed ?? []).length, failed: false };
}

export async function runInboxHousekeeping(db: Db): Promise<HousekeepingResult> {
  const uploads = await removeOrphanStagedUploads(db);
  return { orphanUploadsRemoved: uploads.removed, failures: Number(uploads.failed) };
}
