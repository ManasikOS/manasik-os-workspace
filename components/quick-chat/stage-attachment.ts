import { prepareStaffAttachmentUpload } from "@/app/inbox/actions";
import {
  checkQuickChatAttachment,
  type QuickChatAttachmentInput,
  type QuickChatAttachmentState,
} from "@/lib/inbox/quick-chat/attachment";
import { createClient } from "@/utils/supabase/client";

const ATTACHMENT_BUCKET = "inbox-attachments";

type Settled = Extract<QuickChatAttachmentState, { status: "ready" | "failed" }>;

/**
 * Uploads the page's file for one conversation and answers with how it ended. The server issues the storage path (and, at send time,
 * reads the stored file back and judges it from its own bytes); the browser only uploads. Never throws.
 */
export async function stageQuickChatAttachment(conversationId: string, input: QuickChatAttachmentInput): Promise<Settled> {
  const byteSize = input.file.size;
  const mimeType = input.file.type;
  const failed = (error: string): Settled => ({ status: "failed", filename: input.filename, byteSize, error });

  const early = checkQuickChatAttachment({ filename: input.filename, mimeType, byteSize });
  if (!early.ok) return failed(early.error);

  try {
    const prepared = await prepareStaffAttachmentUpload({ conversationId, filename: input.filename, mimeType, byteSize });
    if (!prepared.ok) return failed(prepared.error);
    const { error } = await createClient()
      .storage.from(ATTACHMENT_BUCKET)
      .uploadToSignedUrl(prepared.path, prepared.token, input.file, { contentType: mimeType });
    if (error) return failed("The upload didn't finish. Try again.");
    return {
      status: "ready",
      filename: prepared.filename,
      byteSize,
      ref: { path: prepared.path, filename: prepared.filename, mimeType },
    };
  } catch {
    return failed("The upload didn't finish. Try again.");
  }
}
