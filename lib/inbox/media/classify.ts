export type MediaKind = "VOICE" | "PASSPORT" | "RECEIPT" | "BROCHURE" | "OTHER";

export function classifyInboundMedia(input: { mimeType: string; filename?: string | null; extractedText?: string | null }): { kind: MediaKind; sensitiveKinds: string[] } {
  const haystack = `${input.filename ?? ""} ${input.extractedText ?? ""}`.toLowerCase();
  if (input.mimeType.startsWith("audio/")) return { kind: "VOICE", sensitiveKinds: [] };
  if (/passport|travel document|passport no/.test(haystack)) return { kind: "PASSPORT", sensitiveKinds: ["PASSPORT"] };
  if (/receipt|payment proof|bank transfer|transaction/.test(haystack)) return { kind: "RECEIPT", sensitiveKinds: ["PAYMENT_PROOF"] };
  if (/brochure|itinerary/.test(haystack) || input.mimeType === "application/pdf") return { kind: "BROCHURE", sensitiveKinds: [] };
  return { kind: "OTHER", sensitiveKinds: [] };
}

/** Office and text documents the Inbox keeps and shows, but the reading model does not analyse. */
const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

export type InboxAttachmentFamily = "IMAGE" | "DOCUMENT" | "AUDIO";

/**
 * The Inbox accepts images, documents and audio (including voice notes). Video is deliberately not accepted, and
 * neither is anything else (archives, executables): a file outside this list is never downloaded or stored.
 */
export function inboxAttachmentFamily(input: { mimeType: string; providerType?: string | null }): InboxAttachmentFamily | null {
  if (input.providerType === "video") return null;
  const mimeType = input.mimeType.split(";")[0].trim().toLowerCase();
  if (mimeType.startsWith("video/")) return null;
  // Messenger and Instagram send a file without saying what it is; it is kept as a document.
  if (input.providerType === "file" && mimeType === "application/octet-stream") return "DOCUMENT";
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  if (DOCUMENT_MIME_TYPES.has(mimeType)) return "DOCUMENT";
  return null;
}
