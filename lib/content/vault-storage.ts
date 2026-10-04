/**
 * Document Vault file I/O: uploading a file (browser-driven, via a signed
 * URL, or server-generated, e.g. a brochure PDF) into the `content-vault`
 * bucket, resolving a short-lived download link, and bridging a vault
 * document into a specific conversation's outbound attachment path so the
 * existing staff-attachment send pipeline (`lib/inbox/attachments/staged-file.ts`,
 * `sendStaffMessage`) can send it without any changes of its own.
 */

import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { findAllowedType, stagedAttachmentPath, type StagedAttachmentRef } from "@/lib/inbox/attachments/staff-attachment";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export const CONTENT_VAULT_BUCKET = "content-vault";

export class VaultStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(cause instanceof Error ? `${message}: ${cause.message}` : message);
    this.name = "VaultStorageError";
  }
}

/** A category folder segment: lowercased, spaces to hyphens — cosmetic only, never trusted as an identity boundary (agency_id is). */
function categorySlug(category: string): string {
  return category.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "other";
}

/** Names a server-generated vault object (a brochure PDF today). Built from ids and a fresh uuid, never from a title, so a title cannot steer the path. */
export function vaultBrochurePath(input: { agencyId: string; contentItemId: string; extension: string }): string {
  return `${input.agencyId}/brochures/${input.contentItemId}/${randomUUID()}.${input.extension}`;
}

/** Names a vault copy of a file a customer sent in the Inbox. Built from ids and a fresh uuid, never from the customer's filename. */
export function vaultInboxMediaPath(input: { agencyId: string; documentId: string; extension: string }): string {
  return `${input.agencyId}/inbox-media/${input.documentId}/${randomUUID()}.${input.extension}`;
}

export async function uploadVaultFile(
  admin: Db,
  input: { path: string; bytes: Buffer; contentType: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.storage.from(CONTENT_VAULT_BUCKET).upload(input.path, input.bytes, {
    contentType: input.contentType,
    upsert: false,
  });
  if (error) return { ok: false, error: "The generated file could not be saved to the vault." };
  return { ok: true };
}

export async function resolveVaultFileSignedUrl(admin: Db, storagePath: string, expiresInSeconds = 600): Promise<string | null> {
  const { data, error } = await admin.storage.from(CONTENT_VAULT_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export type VaultUploadUrlResult =
  | { ok: true; path: string; token: string; filename: string }
  | { ok: false; error: string };

/**
 * Issues a one-file upload authorisation for the vault dialog's "Upload"
 * button — the browser uploads straight to the private bucket (never
 * through a serverless request body), and the byte-level checks run again
 * at send time via `stageVaultFileForConversation` → `verifyStagedAttachment`,
 * the same "the browser's word is never proof" posture as staff attachments.
 */
export async function createVaultUploadUrl(
  admin: Db,
  input: { agencyId: string; category: string; filename: string; mimeType: string },
): Promise<VaultUploadUrlResult> {
  const type = findAllowedType(input.mimeType);
  if (!type) return { ok: false, error: "This file type can't be stored in the vault." };
  const path = `${input.agencyId}/${categorySlug(input.category)}/${randomUUID()}.${type.extensions[0]}`;
  const { data, error } = await admin.storage.from(CONTENT_VAULT_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return { ok: false, error: "The upload could not be started. Please try again." };
  return { ok: true, path, token: data.token, filename: input.filename };
}

export type VerifiedVaultUpload =
  | { ok: true; path: string; mimeType: string; byteSize: number }
  | { ok: false; error: string };

/** Reads the just-uploaded object back and judges it from its own bytes, exactly like `verifyStagedAttachment` does for a staff-sent file. */
export async function verifyVaultUpload(
  admin: Db,
  input: { path: string; mimeType: string },
): Promise<VerifiedVaultUpload> {
  const type = findAllowedType(input.mimeType);
  if (!type) return { ok: false, error: "This file type can't be stored in the vault." };
  const stored = await admin.storage.from(CONTENT_VAULT_BUCKET).download(input.path);
  if (stored.error || !stored.data) return { ok: false, error: "The file wasn't uploaded. Try again." };
  const bytes = new Uint8Array(await stored.data.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > type.maxBytes) {
    await admin.storage.from(CONTENT_VAULT_BUCKET).remove([input.path]).catch(() => undefined);
    return { ok: false, error: "That file is empty or too large." };
  }
  return { ok: true, path: input.path, mimeType: type.mimeType, byteSize: bytes.byteLength };
}

export type StageVaultFileResult = { ok: true; ref: StagedAttachmentRef } | { ok: false; error: string };

/**
 * Copies a vault file's bytes into the conversation's own outbound path so
 * it looks, to `verifyStagedAttachment`/`sendStaffMessage`, exactly like a
 * file the staff member just uploaded from the composer's paperclip button.
 * Nothing about the send pipeline itself changes.
 */
export async function stageVaultFileForConversation(
  admin: Db,
  input: { agencyId: string; conversationId: string; storagePath: string; filename: string; mimeType: string },
): Promise<StageVaultFileResult> {
  const type = findAllowedType(input.mimeType);
  if (!type) return { ok: false, error: "This file type can't be sent." };

  const downloaded = await admin.storage.from(CONTENT_VAULT_BUCKET).download(input.storagePath);
  if (downloaded.error || !downloaded.data) return { ok: false, error: "The file could not be read from the vault." };
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());

  const path = stagedAttachmentPath({ agencyId: input.agencyId, conversationId: input.conversationId, objectId: randomUUID(), type });
  const upload = await admin.storage.from("inbox-attachments").upload(path, bytes, { contentType: type.mimeType, upsert: true });
  if (upload.error) return { ok: false, error: "The file could not be staged for this conversation." };

  return { ok: true, ref: { path, filename: input.filename, mimeType: type.mimeType } };
}
