import "server-only";
import type { Db } from "@/lib/ai/db";

/**
 * Takes the attachment for ONE save to Documents. Only the request that changes `promoted_document_id` from empty wins, so a double click or a
 * second tab cannot run the copy twice (the second would otherwise fail on the already-submitted document and delete the first one's file).
 * While held, the attachment also counts as saved to the retention sweep, which leaves it alone. Release it if the save does not finish.
 */
export async function claimInboxAttachmentForPromotion(db: Db, input: { agencyId: string; attachmentId: string; documentId: string }): Promise<boolean> {
  const { data, error } = await db
    .from("message_attachments")
    .update({ promoted_document_id: input.documentId })
    .eq("id", input.attachmentId)
    .eq("agency_id", input.agencyId)
    .is("promoted_document_id", null)
    .select("id");
  if (error) throw new Error(`Unable to start saving the attachment to Documents: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Gives the attachment back after a save that did not finish. Releases only this request's own claim. */
export async function releaseInboxAttachmentClaim(db: Db, input: { agencyId: string; attachmentId: string; documentId: string }): Promise<void> {
  const { error } = await db
    .from("message_attachments")
    .update({ promoted_document_id: null })
    .eq("id", input.attachmentId)
    .eq("agency_id", input.agencyId)
    .eq("promoted_document_id", input.documentId);
  if (error) console.error("Could not release the attachment after a failed save to Documents:", error.message);
}

/** Called only after the Documents module has created its stricter-access record and copied the object. Finishes this request's own claim (or marks an unclaimed attachment). */
export async function markInboxAttachmentPromoted(db: Db, input: { agencyId: string; attachmentId: string; documentId: string }): Promise<void> {
  const { error } = await db.from("message_attachments").update({ promoted_document_id: input.documentId, expires_at: null }).eq("id", input.attachmentId).eq("agency_id", input.agencyId).or(`promoted_document_id.is.null,promoted_document_id.eq.${input.documentId}`);
  if (error) throw new Error(`Unable to mark the attachment as saved to Documents: ${error.message}`);
}
