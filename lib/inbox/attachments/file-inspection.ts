import "server-only";

import { inflateRawSync, inflateSync } from "node:zlib";

/**
 * The deeper look at a file staff are about to send (SEC-8 in docs/progress/2026-10-05-inbox-security-and-bug-audit.md). The first pass in
 * `staff-attachment.ts` only searched the raw bytes for a few words, which a PDF defeats by writing `/Java#53cript`, by keeping its objects inside a
 * compressed object stream, or by using `/JS` or `/EmbeddedFile`; and any ZIP at all passed as a Word, Excel or PowerPoint file.
 *
 * This is still a POLICY FILTER, not a virus scanner. It decides what an agency should send a customer: no script, no launch action, no embedded
 * program, no macro, and a file that really has the structure of what it claims to be. It cannot recognise malware that hides in a way it does not
 * look for, so a file that passes is still recorded as unscanned. Where it cannot read something it needs to (an encrypted PDF, an unusual
 * compression), it refuses rather than guesses.
 *
 * Every read is bounded (output size, entry counts), so a crafted file cannot make the server spend unbounded memory or time.
 */

export type InspectionVerdict = { ok: true } | { ok: false; error: string };

const MB = 1024 * 1024;
const OK: InspectionVerdict = { ok: true };
const refuse = (error: string): InspectionVerdict => ({ ok: false, error });

/* ── PDF ──────────────────────────────────────────────────────────────────── */

/**
 * PDF dictionary keys that run code, start a program, carry another file, or post data somewhere.
 *
 * `/JS` is deliberately not on the list. A script action cannot run without the name `/JavaScript`, which is, and a bare three-byte `/JS` turns up
 * by chance inside the compressed image data of an ordinary large PDF often enough (several percent of 10 MB files) to refuse good files for nothing.
 */
const PDF_BLOCKED_KEYS = ["JavaScript", "Launch", "EmbeddedFile", "EmbeddedFiles", "RichMedia", "XFA", "SubmitForm", "ImportData", "GoToR", "GoToE"] as const;
/** A PDF name ends at whitespace or one of these delimiters, so `/Launch` matches but `/Launcher` does not. */
const PDF_BLOCKED_KEY_PATTERN = new RegExp(`/(?:${PDF_BLOCKED_KEYS.join("|")})(?=[\\s()<>\\[\\]{}/%]|$)`);
const PDF_ENCRYPT_PATTERN = /\/Encrypt(?=[\s()<>[\]{}/%]|$)/;

const PDF_MAX_OBJECT_STREAMS = 2_000;
const PDF_MAX_INFLATED_PER_STREAM = 20 * MB;
const PDF_MAX_INFLATED_TOTAL = 60 * MB;

export const PDF_SCRIPT_MESSAGE = "This PDF contains a script, launch action or attached file, so it can't be sent. Export it again as a plain PDF.";
export const PDF_ENCRYPTED_MESSAGE = "This PDF is password-protected, so it can't be checked and wasn't sent. Save a copy without a password.";
export const PDF_UNCHECKABLE_MESSAGE = "This PDF is built in a way that can't be checked, so it wasn't sent. Export it again as a plain PDF.";

/** PDF names may spell any character as `#` and two hex digits, so `/Java#53cript` is `/JavaScript`. */
function decodePdfNames(text: string): string {
  return text.replace(/#([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function pdfHasBlockedKey(decodedText: string): boolean {
  return PDF_BLOCKED_KEY_PATTERN.test(decodedText);
}

/** The compressed object streams of a PDF: where its dictionaries can be hidden from a search of the raw bytes. */
function* objectStreams(text: string): Generator<{ dictionary: string; data: Buffer }> {
  const streamKeyword = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamKeyword.exec(text)) !== null) {
    const keywordStart = match.index;
    // "endstream" also contains "stream"; the one that starts a stream follows a dictionary's closing ">>".
    if (text.startsWith("end", keywordStart - 3)) continue;
    const window = text.slice(Math.max(0, keywordStart - 4_096), keywordStart);
    const objectStart = window.lastIndexOf("obj");
    const dictionary = decodePdfNames(objectStart >= 0 ? window.slice(objectStart) : window);
    if (!/\/Type\s*\/ObjStm(?=[\s()<>[\]{}/%]|$)/.test(dictionary)) continue;
    const dataStart = keywordStart + match[0].length;
    const dataEnd = text.indexOf("endstream", dataStart);
    yield { dictionary, data: Buffer.from(text.slice(dataStart, dataEnd === -1 ? text.length : dataEnd), "latin1") };
  }
}

export function inspectPdf(bytes: Uint8Array): InspectionVerdict {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const decoded = decodePdfNames(text);

  if (PDF_ENCRYPT_PATTERN.test(decoded)) return refuse(PDF_ENCRYPTED_MESSAGE);
  if (pdfHasBlockedKey(decoded)) return refuse(PDF_SCRIPT_MESSAGE);

  let streams = 0;
  let inflatedTotal = 0;
  for (const stream of objectStreams(text)) {
    streams += 1;
    if (streams > PDF_MAX_OBJECT_STREAMS) return refuse(PDF_UNCHECKABLE_MESSAGE);
    const filter = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(stream.dictionary)?.[1];
    // No filter: the objects are plain bytes and were already searched above. Anything but plain Flate we cannot unpack, so we cannot vouch for it.
    if (!filter) continue;
    if (!/^(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])$/.test(filter.trim())) return refuse(PDF_UNCHECKABLE_MESSAGE);
    let inflated: Buffer;
    try {
      inflated = inflateSync(stream.data, { maxOutputLength: PDF_MAX_INFLATED_PER_STREAM });
    } catch {
      return refuse(PDF_UNCHECKABLE_MESSAGE);
    }
    inflatedTotal += inflated.byteLength;
    if (inflatedTotal > PDF_MAX_INFLATED_TOTAL) return refuse(PDF_UNCHECKABLE_MESSAGE);
    if (pdfHasBlockedKey(decodePdfNames(inflated.toString("latin1")))) return refuse(PDF_SCRIPT_MESSAGE);
  }
  return OK;
}

/* ── Word, Excel and PowerPoint (OOXML, a ZIP) ────────────────────────────── */

export type OfficeKind = "docx" | "xlsx" | "pptx";

/** The folder every genuine file of each kind keeps its main part in. A ZIP without it is not that kind of file, whatever it is called. */
const OFFICE_ROOT_FOLDER: Record<OfficeKind, string> = { docx: "word/", xlsx: "xl/", pptx: "ppt/" };

const ZIP_MAX_ENTRIES = 4_000;
const ZIP_MAX_TOTAL_UNCOMPRESSED = 100 * MB;
const ZIP_MAX_CONTENT_TYPES = 2 * MB;

export const OFFICE_MACRO_MESSAGE = "This file contains macros or embedded programs, so it can't be sent. Save it as a plain document without macros.";
export const OFFICE_NOT_OFFICE_MESSAGE = "This file isn't a genuine Word, Excel or PowerPoint file, so it wasn't sent. Save it again from the program.";
export const OFFICE_UNCHECKABLE_MESSAGE = "This file is built in a way that can't be checked, so it wasn't sent. Save it again from Word, Excel or PowerPoint.";

/** Parts a plain document has no need of: macros, Excel 4.0 macro sheets, ActiveX, embedded objects, and programs of any kind. */
const BLOCKED_ENTRY_NAME = /(?:vbaproject|\/macrosheets\/|\/activex\/|\/embeddings\/|oleobject)/;
const BLOCKED_ENTRY_EXTENSION = /\.(?:exe|dll|scr|bat|cmd|com|msi|js|jse|vbs|vbe|wsf|ps1|hta|lnk|jar|cpl|reg)$/;
/** Content types that announce a macro-enabled or ActiveX-carrying file even if the parts have unusual names. */
const BLOCKED_CONTENT_TYPE = /(?:vbaProject|macroEnabled|ms-office\.activeX|oleObject|vnd\.ms-excel\.sheet\.binary\.macroEnabled)/i;

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

/** Reads a ZIP's central directory. Names live there uncompressed, so the whole file never has to be unpacked to know what it holds. */
function readZipEntries(bytes: Uint8Array): ZipEntry[] | "ZIP64" | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength;
  // The end-of-central-directory record is within 65,557 bytes of the end (a 22-byte record plus up to a 65,535-byte comment).
  let eocd = -1;
  for (let at = end - 22; at >= Math.max(0, end - 22 - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return "ZIP64";
  if (count > ZIP_MAX_ENTRIES || directoryOffset + directorySize > eocd) return null;

  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) return null;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) return "ZIP64";
    if (at + 46 + nameLength > end) return null;
    const name = Buffer.from(bytes.buffer, bytes.byteOffset + at + 46, nameLength).toString("utf8");
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The text of one small entry, or null if it cannot be read within the limit. */
function readEntryText(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localOffset;
  if (at + 30 > bytes.byteLength || view.getUint32(at, true) !== 0x04034b50) return null;
  const dataStart = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  if (dataStart + entry.compressedSize > bytes.byteLength) return null;
  const data = Buffer.from(bytes.buffer, bytes.byteOffset + dataStart, entry.compressedSize);
  try {
    if (entry.method === 0) return data.byteLength <= maxBytes ? data.toString("utf8") : null;
    if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: maxBytes }).toString("utf8");
  } catch {
    return null;
  }
  return null;
}

export function inspectOoxml(bytes: Uint8Array, kind: OfficeKind): InspectionVerdict {
  const entries = readZipEntries(bytes);
  if (entries === "ZIP64") return refuse(OFFICE_UNCHECKABLE_MESSAGE);
  if (!entries || entries.length === 0) return refuse(OFFICE_NOT_OFFICE_MESSAGE);

  let total = 0;
  for (const entry of entries) {
    // An encrypted entry cannot be looked at; an enormous one is a decompression bomb waiting for the customer's program to open it.
    if (entry.flags & 0x1) return refuse(OFFICE_UNCHECKABLE_MESSAGE);
    total += entry.uncompressedSize;
    if (total > ZIP_MAX_TOTAL_UNCOMPRESSED) return refuse(OFFICE_UNCHECKABLE_MESSAGE);
    const name = entry.name.replace(/\\/g, "/").toLowerCase();
    if (BLOCKED_ENTRY_NAME.test(`/${name}`) || BLOCKED_ENTRY_EXTENSION.test(name)) return refuse(OFFICE_MACRO_MESSAGE);
  }

  const contentTypes = entries.find((entry) => entry.name === "[Content_Types].xml");
  if (!contentTypes || !entries.some((entry) => entry.name.toLowerCase().startsWith(OFFICE_ROOT_FOLDER[kind]))) return refuse(OFFICE_NOT_OFFICE_MESSAGE);

  const contentTypesText = readEntryText(bytes, contentTypes, ZIP_MAX_CONTENT_TYPES);
  if (contentTypesText === null) return refuse(OFFICE_UNCHECKABLE_MESSAGE);
  if (BLOCKED_CONTENT_TYPE.test(contentTypesText)) return refuse(OFFICE_MACRO_MESSAGE);
  return OK;
}

/** The deep check for a file of this type, or "ok" for a type that has none (a photo). */
export function inspectStagedFileContent(input: { mimeType: string; bytes: Uint8Array }): InspectionVerdict {
  switch (input.mimeType.toLowerCase()) {
    case "application/pdf":
      return inspectPdf(input.bytes);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return inspectOoxml(input.bytes, "docx");
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return inspectOoxml(input.bytes, "xlsx");
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return inspectOoxml(input.bytes, "pptx");
    default:
      return OK;
  }
}
