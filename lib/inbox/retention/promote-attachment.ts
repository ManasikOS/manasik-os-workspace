import "server-only";
import type { Db } from "@/lib/ai/db";

/** Called only after the Documents module has created its stricter-access record and copied the object. */
export async function markInboxAttachmentPromoted(db: Db, input: { agencyId: string; attachmentId: string; documentId: string }): Promise<void> {
  const { error } = await db.from("message_attachments").update({ promoted_document_id: input.documentId, expires_at: null }).eq("id", input.attachmentId).eq("agency_id", input.agencyId).is("promoted_document_id", null);
  if (error) throw new Error(`Unable to mark the attachment as saved to Documents: ${error.message}`);
}
