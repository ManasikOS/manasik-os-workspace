"use server";

import { revalidatePath } from "next/cache";

import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import { CONTENT_VAULT_BUCKET, stageVaultFileForConversation } from "@/lib/content/vault-storage";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createVaultDocument, deleteVaultDocument } from "@/lib/data/vault-repository";
import { loadInboxMediaContext } from "@/lib/inbox/media/context";
import { INBOX_ATTACHMENT_BUCKET } from "@/lib/inbox/media/handlers";
import { createInboxMediaVaultSaver } from "@/lib/inbox/media/media-to-vault";
import type { MediaRoutingKind } from "@/lib/inbox/media/routing";
import { requireUser } from "@/lib/dal";
import type { StagedAttachmentRef } from "@/lib/inbox/attachments/staff-attachment";
import { saveInboxMediaToVaultSchema, stageVaultDocumentInputSchema } from "@/lib/validations/vault";
import { createAdminClient } from "@/utils/supabase/admin";

export type StageVaultDocumentResult =
  | { ok: true; ref: StagedAttachmentRef; fileName: string; fileSizeBytes: number }
  | { ok: false; error: string };

/**
 * Copies an already-uploaded vault document into this conversation's
 * outbound path and hands back a `StagedAttachmentRef` — the exact shape
 * the composer already uses for a file chosen from the device. The browser
 * never re-uploads the file; it was uploaded once, into the vault, and this
 * just makes that same file available to this one conversation's send.
 *
 * Deliberately does not send anything itself: the composer sets its
 * attachment state to "ready" with the returned ref, and the normal Send
 * button/`sendStaffMessage` path (with its protection gate, service-window
 * check and takeover logic, unchanged) takes it from there — a file chosen
 * from the vault and a file chosen from disk end up going through the exact
 * same send code.
 */
export async function stageVaultDocumentForComposerAction(input: unknown): Promise<StageVaultDocumentResult> {
  await requireUser();
  const parsed = stageVaultDocumentInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That document could not be found." };

  const { role, agencyId } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };
  if (!capabilitiesForInbox(role).sendMessage) return { ok: false, error: "Not permitted." };

  const admin = createAdminClient();
  const { data: document, error } = await admin
    .from("vault_documents")
    .select("id, storage_path, file_name, mime_type, file_size_bytes")
    .eq("id", parsed.data.vaultDocumentId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (error || !document) return { ok: false, error: "That document could not be found." };

  const staged = await stageVaultFileForConversation(admin, {
    agencyId,
    conversationId: parsed.data.conversationId,
    storagePath: document.storage_path as string,
    filename: (document.file_name as string | null) ?? "file",
    mimeType: document.mime_type as string,
  });
  if (!staged.ok) return { ok: false, error: staged.error };

  return { ok: true, ref: staged.ref, fileName: staged.ref.filename, fileSizeBytes: (document.file_size_bytes as number | null) ?? 0 };
}

export type SaveInboxMediaToVaultActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Saves a customer's brochure or other file into the Document Vault. It is a copy for staff: nothing is sent to the
 * customer or published. Passports and receipts are refused here because the vault is readable by every staff role;
 * they have their own destinations. Everything is re-derived on the server from the attachment id alone.
 */
export async function saveInboxMediaToVaultAction(input: unknown): Promise<SaveInboxMediaToVaultActionResult> {
  await requireUser();
  const parsed = saveInboxMediaToVaultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid file." };

  const { role, agencyId, name } = await getCurrentStaffRole();
  if (!agencyId) return { ok: false, error: "Your account is not linked to an agency." };

  try {
    const admin = createAdminClient();
    const saver = createInboxMediaVaultSaver({
      async loadSource(scopedAgencyId, attachmentId) {
        const { data: attachment } = await admin
          .from("message_attachments")
          .select("id,message_id,storage_path,filename,mime_type,promoted_document_id")
          .eq("agency_id", scopedAgencyId)
          .eq("id", attachmentId)
          .maybeSingle();
        if (!attachment) return null;
        const [{ data: message }, { data: analysis }] = await Promise.all([
          admin.from("conversation_messages").select("conversation_id").eq("agency_id", scopedAgencyId).eq("id", attachment.message_id as string).maybeSingle(),
          admin.from("message_media_analyses").select("kind").eq("agency_id", scopedAgencyId).eq("attachment_id", attachmentId).maybeSingle(),
        ]);
        if (!message || !analysis) return null;
        return {
          attachmentId: attachment.id as string,
          conversationId: message.conversation_id as string,
          kind: analysis.kind as MediaRoutingKind,
          storagePath: (attachment.storage_path as string | null) ?? null,
          filename: (attachment.filename as string | null) ?? null,
          mimeType: String(attachment.mime_type),
          promotedDocumentId: (attachment.promoted_document_id as string | null) ?? null,
        };
      },
      async loadDepartureGroupId(scopedAgencyId, conversationId) {
        return (await loadInboxMediaContext(admin, { agencyId: scopedAgencyId, conversationId })).departureGroupId;
      },
      async download(storagePath) {
        const stored = await admin.storage.from(INBOX_ATTACHMENT_BUCKET).download(storagePath);
        return stored.error || !stored.data ? null : new Uint8Array(await stored.data.arrayBuffer());
      },
      async upload(path, bytes, mimeType) {
        const uploaded = await admin.storage.from(CONTENT_VAULT_BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
        return { ok: !uploaded.error };
      },
      async createDocument(row) {
        await createVaultDocument(admin, row);
      },
      async claim(scopedAgencyId, attachmentId, documentId) {
        // Conditional on nothing having claimed the attachment, so two saves cannot both win.
        const { data } = await admin
          .from("message_attachments")
          .update({ promoted_document_id: documentId })
          .eq("agency_id", scopedAgencyId)
          .eq("id", attachmentId)
          .is("promoted_document_id", null)
          .select("id");
        return (data ?? []).length > 0;
      },
      async currentPromoted(scopedAgencyId, attachmentId) {
        const { data } = await admin.from("message_attachments").select("promoted_document_id").eq("agency_id", scopedAgencyId).eq("id", attachmentId).maybeSingle();
        return (data?.promoted_document_id as string | null) ?? null;
      },
      async removeDocument(documentId) {
        await deleteVaultDocument(admin, documentId);
      },
      async removeObject(path) {
        await admin.storage.from(CONTENT_VAULT_BUCKET).remove([path]);
      },
    });

    const result = await saver.save({
      agencyId,
      attachmentId: parsed.data.attachmentId,
      destination: parsed.data.destination,
      canSaveToVault: capabilitiesForInbox(role).saveMediaToVault,
      uploadedByName: name ?? "Staff",
    });
    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath("/inbox");
    const where = parsed.data.destination === "PROPOSAL_COLLATERAL" ? "as proposal collateral" : "to Documents";
    return {
      ok: true,
      message: result.alreadySaved
        ? "This file was already saved to Documents."
        : `Saved ${where}${result.linkedDepartureGroup ? " and linked to this chat's departure group" : ""}. Nothing was sent to the customer.`,
    };
  } catch (cause) {
    console.error("saveInboxMediaToVaultAction failed:", cause instanceof Error ? cause.name : "unknown");
    return { ok: false, error: "The file could not be saved. Try again." };
  }
}
