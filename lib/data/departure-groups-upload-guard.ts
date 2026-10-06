/**
 * Pure rules for traveller-file uploads in the private `pilgrim-documents`
 * bucket: where a file may live, and whether its bytes are what it claims.
 *
 * Kept free of server imports so the mutators, the Server Actions and the tests
 * all share one definition. The object key layout is
 * `<agencyId>/<groupId>/<pilgrimId>/<file>`; staged ticket intake lives under
 * `<agencyId>/<groupId>/_ticket-intake/<file>`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** The folder one traveller's files must sit in. */
export function pilgrimFolder(agencyId: string, groupId: string, pilgrimId: string): string {
  return `${agencyId}/${groupId}/${pilgrimId}/`;
}

/**
 * True only when `path` is a file directly inside this traveller's folder. A
 * client sends the path back after uploading, so it is checked rather than
 * trusted: otherwise a document record could point at another traveller's
 * passport scan.
 */
export function isPathInPilgrimFolder(
  path: string,
  agencyId: string,
  groupId: string,
  pilgrimId: string,
): boolean {
  const folder = pilgrimFolder(agencyId, groupId, pilgrimId);
  if (!path.startsWith(folder)) return false;
  const name = path.slice(folder.length);
  return name.length > 0 && !name.includes("/") && !name.includes("..");
}

export type ParsedStoragePath =
  | { ok: true; agencyId: string; groupId: string; pilgrimId: string | null }
  | { ok: false };

/**
 * Splits a stored object path into its owner ids. Only paths of the shapes this
 * module writes are accepted, and the agency must be the caller's own.
 */
export function parseTravellerFilePath(path: string, callerAgencyId: string): ParsedStoragePath {
  if (!path || path.includes("..") || path.includes("\\")) return { ok: false };
  const parts = path.split("/");
  if (parts.length !== 4) return { ok: false };
  const [agencyId, groupId, owner, file] = parts;
  if (agencyId !== callerAgencyId) return { ok: false };
  if (!isUuid(groupId) || !file) return { ok: false };
  if (owner === "_ticket-intake") return { ok: true, agencyId, groupId, pilgrimId: null };
  if (!isUuid(owner)) return { ok: false };
  return { ok: true, agencyId, groupId, pilgrimId: owner };
}

export type UploadKind = "jpg" | "png" | "webp" | "heic" | "pdf";

/** Identifies a file by its leading bytes, regardless of what it was named. */
export function sniffUploadKind(bytes: Uint8Array): UploadKind | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ascii = (from: number, text: string) =>
    [...text].every((ch, i) => bytes[from + i] === ch.charCodeAt(0));

  if (bytes.length < 12) return null;
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (startsWith(0xff, 0xd8, 0xff)) return "jpg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return null;
}

/** Declared MIME type → the kind its bytes must sniff as. */
export const KIND_BY_MIME: Record<string, UploadKind> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/** Kind implied by an object key's extension, or null. */
export function kindFromFileName(name: string): UploadKind | null {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "jpg" || ext === "png" || ext === "webp" || ext === "heic" || ext === "pdf" ? ext : null;
}

/**
 * A file path arrives from the browser after the upload, so it is checked
 * against the traveller it is being attached to. Returns an error message, or
 * null when the path is empty (nothing is being attached) or correctly placed.
 */
export function refuseFileOutsidePilgrimFolder(
  filePath: string | null | undefined,
  agencyId: string | null,
  groupId: string,
  pilgrimId: string,
): string | null {
  const path = filePath?.trim();
  if (!path) return null;
  if (!agencyId || !isPathInPilgrimFolder(path, agencyId, groupId, pilgrimId)) {
    return "That file does not belong to this traveller. Upload it again from this screen.";
  }
  return null;
}
