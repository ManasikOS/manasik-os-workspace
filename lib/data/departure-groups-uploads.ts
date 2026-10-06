import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { kindFromFileName, sniffUploadKind } from "@/lib/data/departure-groups-upload-guard";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const TRAVELLER_FILE_BUCKET = "pilgrim-documents";
export const TRAVELLER_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type StoredUploadCheck = { ok: true } | { ok: false; error: string };

/**
 * Checks what actually landed in storage rather than what the browser said about
 * it: the file exists, is within the size limit, and its leading bytes match the
 * type its key promises (the key's extension was chosen by the server from the
 * declared type, so a mismatch means the declaration was false).
 *
 * Reads the whole object — at most 10 MB — because the storage API offers no
 * cheaper partial read through the session client.
 */
export async function verifyStoredTravellerFile(db: Db, path: string): Promise<StoredUploadCheck> {
  const { data, error } = await db.storage.from(TRAVELLER_FILE_BUCKET).download(path);
  if (error || !data) {
    return { ok: false, error: "That file could not be found. Upload it again." };
  }
  if (data.size === 0 || data.size > TRAVELLER_FILE_MAX_BYTES) {
    return { ok: false, error: "Files must be between 1 byte and 10 MB." };
  }

  const head = new Uint8Array(await data.slice(0, 16).arrayBuffer());
  const actual = sniffUploadKind(head);
  const promised = kindFromFileName(path);
  if (!actual || actual !== promised) {
    return { ok: false, error: "That file is not a valid PDF or photo of the type it claims to be." };
  }
  return { ok: true };
}
