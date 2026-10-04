/**
 * Files a staff member sends from the Inbox composer (F1): what is allowed, how it is checked, and where it is stored. Pure: no I/O,
 * so the rules can be tested exhaustively and are the same in the browser (a friendly early refusal) and on the server (the real one).
 *
 * The server never trusts what the browser says. It decides from the file's own bytes: the declared type must match the file's signature,
 * the size must be within the limit, and a Word/Excel/PowerPoint file must not carry macros and a PDF must not carry a launch action or
 * script. That is an allow-list for what an agency should send a customer, not a malware scanner: nothing here inspects content beyond
 * those markers, so a file is recorded `PENDING` for scanning, never `CLEAN`.
 */

import { z } from "zod";

export type StaffAttachmentKind = "image" | "document";

interface AllowedType {
  mimeType: string;
  kind: StaffAttachmentKind;
  extensions: readonly string[];
  maxBytes: number;
  /** The first bytes a genuine file of this type starts with. */
  signature: readonly number[];
}

const MB = 1024 * 1024;
const ZIP = [0x50, 0x4b, 0x03, 0x04] as const;

/** Images stay at WhatsApp's 5 MB limit; documents at the storage bucket's 10 MB limit (WhatsApp itself allows far more). */
export const ALLOWED_STAFF_ATTACHMENT_TYPES: readonly AllowedType[] = [
  { mimeType: "image/jpeg", kind: "image", extensions: ["jpg", "jpeg"], maxBytes: 5 * MB, signature: [0xff, 0xd8, 0xff] },
  { mimeType: "image/png", kind: "image", extensions: ["png"], maxBytes: 5 * MB, signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: "application/pdf", kind: "document", extensions: ["pdf"], maxBytes: 10 * MB, signature: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document", extensions: ["docx"], maxBytes: 10 * MB, signature: ZIP },
  { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document", extensions: ["xlsx"], maxBytes: 10 * MB, signature: ZIP },
  { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document", extensions: ["pptx"], maxBytes: 10 * MB, signature: ZIP },
];

export const STAFF_ATTACHMENT_MAX_BYTES = Math.max(...ALLOWED_STAFF_ATTACHMENT_TYPES.map((type) => type.maxBytes));
/** The `accept` value for the file picker. A convenience only: the server decides. */
export const STAFF_ATTACHMENT_ACCEPT = ALLOWED_STAFF_ATTACHMENT_TYPES.flatMap((type) => type.extensions.map((extension) => `.${extension}`)).join(",");

export function findAllowedType(mimeType: string): AllowedType | null {
  return ALLOWED_STAFF_ATTACHMENT_TYPES.find((type) => type.mimeType === mimeType.toLowerCase()) ?? null;
}

/** Instagram messaging carries images only. Messenger, WhatsApp and Email carry images and documents. */
const CHANNEL_KINDS: Record<string, readonly StaffAttachmentKind[]> = {
  WHATSAPP: ["image", "document"],
  MESSENGER: ["image", "document"],
  INSTAGRAM: ["image"],
  GMAIL: ["image", "document"],
};

export function channelAcceptsAttachment(channel: string, kind: StaffAttachmentKind): boolean {
  return (CHANNEL_KINDS[channel] ?? []).includes(kind);
}

/** A display name that is safe to store, show and send: no path, no control characters, bounded, with the extension the type requires. */
export function sanitizeAttachmentFilename(raw: string, type: AllowedType): string {
  const base = raw
    .replace(/[\\/]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim().slice(0, 100) || "file";
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  return `${stem}.${type.extensions.includes(extension) ? extension : type.extensions[0]}`;
}

/** Names the stored object. Built from ids and a fresh uuid, never from the file's own name, so a name cannot steer the path. */
export function stagedAttachmentPath(input: { agencyId: string; conversationId: string; objectId: string; type: AllowedType }): string {
  return `${input.agencyId}/outbound/${input.conversationId}/${input.objectId}.${input.type.extensions[0]}`;
}

/** True when `path` is a staged outbound attachment of exactly this agency and conversation. */
export function isStagedPathFor(path: string, agencyId: string, conversationId: string): boolean {
  // Both ids go into a pattern below, so they must be plain uuids first.
  if (!idSchema.safeParse(agencyId).success || !idSchema.safeParse(conversationId).success) return false;
  const pattern = new RegExp(`^${agencyId}/outbound/${conversationId}/[0-9a-f-]{36}\\.(?:${ALLOWED_STAFF_ATTACHMENT_TYPES.flatMap((type) => type.extensions).join("|")})$`);
  return pattern.test(path);
}

// A shaped-like-a-uuid check, not a strict RFC 4122 one: `z.string().uuid()` rejects a syntactically valid
// Postgres uuid whose version/variant nibbles don't conform (e.g. a seed/system row such as
// "00000000-0000-0000-0000-000000000001"), which Postgres itself stores and returns without complaint. `.guid()`
// accepts any 8-4-4-4-12 hex string — still safe here, since the only thing this protects against is regex
// metacharacters reaching `isStagedPathFor`'s pattern, not a real identity check.
const idSchema = z.string().guid();

/** What the browser asks for before uploading. The size is the browser's claim, checked again against the stored object. */
export const prepareStaffAttachmentSchema = z
  .object({
    conversationId: idSchema,
    filename: z.string().min(1, "Choose a file.").max(255, "That file name is too long."),
    mimeType: z.string().min(1).max(200),
    byteSize: z.number().int().positive("That file is empty."),
  })
  .superRefine((value, context) => {
    const type = findAllowedType(value.mimeType);
    if (!type) {
      context.addIssue({ code: "custom", path: ["mimeType"], message: "This file type can't be sent. Use a JPG or PNG photo, a PDF, or a Word, Excel or PowerPoint file." });
      return;
    }
    if (value.byteSize > type.maxBytes) {
      context.addIssue({ code: "custom", path: ["byteSize"], message: `That file is too large. ${type.kind === "image" ? "Photos" : "Documents"} can be up to ${type.maxBytes / MB} MB.` });
    }
  });

/** The reference to an uploaded file that goes with a send. Everything is re-derived from the stored object, not from these fields. */
export const stagedAttachmentRefSchema = z.object({
  path: z.string().min(1).max(300),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
});
export type StagedAttachmentRef = z.infer<typeof stagedAttachmentRefSchema>;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

/** Case-sensitive search for ASCII text inside binary data. */
function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const target = Buffer.from(needle, "latin1");
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(target);
}

export type StagedBytesVerdict = { ok: true; type: AllowedType } | { ok: false; error: string };

/** The server-side decision, made from the stored bytes. */
export function verifyStagedBytes(input: { mimeType: string; bytes: Uint8Array }): StagedBytesVerdict {
  const type = findAllowedType(input.mimeType);
  if (!type) return { ok: false, error: "This file type can't be sent." };
  if (input.bytes.byteLength === 0) return { ok: false, error: "That file is empty." };
  if (input.bytes.byteLength > type.maxBytes) return { ok: false, error: `That file is too large. ${type.kind === "image" ? "Photos" : "Documents"} can be up to ${type.maxBytes / MB} MB.` };
  if (!startsWith(input.bytes, type.signature)) return { ok: false, error: "This file doesn't match its type, so it wasn't sent. Save it again as the right kind of file." };
  if (type.signature === ZIP && containsAscii(input.bytes, "vbaProject.bin")) return { ok: false, error: "This file contains macros, so it can't be sent. Save it without macros." };
  if (type.mimeType === "application/pdf" && (containsAscii(input.bytes, "/Launch") || containsAscii(input.bytes, "/JavaScript"))) {
    return { ok: false, error: "This PDF contains a script or launch action, so it can't be sent. Export it again as a plain PDF." };
  }
  return { ok: true, type };
}
