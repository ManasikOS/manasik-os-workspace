import { findAllowedType, type StagedAttachmentRef } from "@/lib/inbox/attachments/staff-attachment";

/**
 * One file with a Quick Chat message. v1 is a single PDF (a quote, an invoice, a receipt) that the page has already built in the browser.
 * The browser only uploads it: the server issues the storage path and, at send time, reads the stored file back and judges it from its own
 * bytes, so the checks here are a quick and friendly refusal, never the guard.
 */

export const QUICK_CHAT_ATTACHMENT_MIME = "application/pdf";

export interface QuickChatAttachmentInput {
  /** The file as built by the page (for example `buildInvoicePdf`). */
  file: Blob;
  /** What the customer will see, such as "Invoice INV-0042.pdf". */
  filename: string;
}

export type QuickChatAttachmentState =
  | { status: "none" }
  | { status: "uploading"; filename: string; byteSize: number }
  | { status: "ready"; filename: string; byteSize: number; ref: StagedAttachmentRef }
  | { status: "failed"; filename: string; byteSize: number; error: string };

export type QuickChatAttachmentCheck = { ok: true } | { ok: false; error: string };

export function checkQuickChatAttachment(input: { filename: string; mimeType: string; byteSize: number }): QuickChatAttachmentCheck {
  if (input.mimeType !== QUICK_CHAT_ATTACHMENT_MIME) {
    return { ok: false, error: "Only a PDF can be attached here." };
  }
  if (input.byteSize <= 0) return { ok: false, error: "That file is empty." };
  const limit = findAllowedType(QUICK_CHAT_ATTACHMENT_MIME)?.maxBytes ?? 0;
  if (input.byteSize > limit) return { ok: false, error: `That file is too large. Documents can be up to ${Math.round(limit / (1024 * 1024))} MB.` };
  return { ok: true };
}

/**
 * Whether the send button may be pressed. A file that is still uploading, or that failed, blocks it: sending only the text would quietly
 * leave the file out, and the person must choose that by removing the file.
 */
export function canSendQuickChat(input: { draft: string; attachment: QuickChatAttachmentState }): boolean {
  switch (input.attachment.status) {
    case "uploading":
    case "failed":
      return false;
    case "ready":
      return true;
    case "none":
      return input.draft.trim().length > 0;
  }
}
