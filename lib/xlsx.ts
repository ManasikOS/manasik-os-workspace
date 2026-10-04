/**
 * Minimal, dependency-free `.xlsx` read/write, shared by every spreadsheet
 * import/export in the app (Departure Groups, Suppliers, …).
 *
 * Why hand-rolled rather than a library: an `.xlsx` is just a ZIP of XML parts,
 * and the platform already ships the hard part — DEFLATE — as
 * `DecompressionStream`. So reading is "unzip with the native inflater, then
 * pull text out of two XML files", and writing is "emit those XML files into a
 * STORED (uncompressed) ZIP", which Excel, Numbers and Google Sheets all open.
 * That keeps a heavyweight spreadsheet dependency out of the bundle.
 *
 * Scope is deliberately small: a single sheet of string cells, which is exactly
 * what an import/export needs. It is not a general spreadsheet library.
 *
 * Client-only — it uses `Blob`, `DecompressionStream`, `TextEncoder` and
 * `DataView`. Import it from client components.
 */

import { parseCsv } from "./csv";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/* ── CRC-32 (for the ZIP writer) ──────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/* ── ZIP (STORED / no compression) ────────────────────────────────────────── */

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Builds a ZIP archive with every entry STORED. Excel does not require
 * compression, so skipping it avoids needing `CompressionStream` and keeps the
 * writer synchronous.
 */
function zipStore(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(local.buffer);
    ldv.setUint32(0, 0x04034b50, true); // local file header signature
    ldv.setUint16(4, 20, true); // version needed
    ldv.setUint16(6, 0, true); // flags
    ldv.setUint16(8, 0, true); // method: stored
    ldv.setUint16(10, 0, true); // mod time
    ldv.setUint16(12, 0, true); // mod date
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, size, true); // compressed size
    ldv.setUint32(22, size, true); // uncompressed size
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true); // extra length
    local.set(nameBytes, 30);

    localChunks.push(local, entry.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true); // central dir header signature
    cdv.setUint16(4, 20, true); // version made by
    cdv.setUint16(6, 20, true); // version needed
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true); // method: stored
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true); // extra
    cdv.setUint16(32, 0, true); // comment
    cdv.setUint16(34, 0, true); // disk number
    cdv.setUint16(36, 0, true); // internal attrs
    cdv.setUint32(38, 0, true); // external attrs
    cdv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    centralChunks.push(central);

    offset += local.length + size;
  }

  const centralSize = centralChunks.reduce((s, c) => s + c.length, 0);
  const centralOffset = offset;

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true); // end of central dir signature
  edv.setUint16(8, entries.length, true); // entries on this disk
  edv.setUint16(10, entries.length, true); // total entries
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, centralOffset, true);

  return concatBytes([...localChunks, ...centralChunks, eocd]);
}

/** Reads a STORED-or-DEFLATED ZIP into name → bytes, via the native inflater. */
async function unzip(buffer: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // The End Of Central Directory record sits at the tail; scan back for it.
  let eocd = -1;
  const min = Math.max(0, buffer.length - 22 - 65536);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("That file is not a valid .xlsx workbook.");

  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();

  for (let e = 0; e < count; e++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = decoder.decode(buffer.subarray(ptr + 46, ptr + 46 + nameLen));

    // The local header repeats the name/extra lengths; use them to find data.
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compData = buffer.subarray(dataStart, dataStart + compSize);

    files.set(name, method === 0 ? compData : await inflateRaw(compData));
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser cannot read .xlsx files. Please upload a CSV instead.",
    );
  }
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ── XML helpers ──────────────────────────────────────────────────────────── */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    // Ampersand last so the replacements above aren't re-decoded.
    .replace(/&amp;/g, "&");
}

function attr(attrs: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return match ? match[1] : null;
}

/** `"B12"` → column index 1 (0-based). */
function columnIndex(ref: string): number {
  const match = /^([A-Za-z]+)/.exec(ref);
  if (!match) return 0;
  const letters = match[1].toUpperCase();
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

/** Column index 0 → `"A"`, 26 → `"AA"`. */
function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Concatenates every `<t>` run inside a fragment (shared string or inline). */
function textRuns(fragment: string): string {
  let text = "";
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) text += m[1];
  return decodeEntities(text);
}

/* ── Read ─────────────────────────────────────────────────────────────────── */

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) strings.push(textRuns(m[1]));
  return strings;
}

function pickSheetPart(files: Map<string, Uint8Array>): string | null {
  if (files.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  for (const name of files.keys()) {
    if (/^xl\/worksheets\/sheet[^/]*\.xml$/.test(name)) return name;
  }
  return null;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  let autoRow = 0;

  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(xml))) {
    const rowAttrs = rowMatch[1] ?? rowMatch[3] ?? "";
    const rowInner = rowMatch[2] ?? "";
    autoRow++;
    const rowRef = attr(rowAttrs, "r");
    const rowIndex = rowRef ? Number(rowRef) : autoRow;

    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(rowInner))) {
      const cellAttrs = cellMatch[1];
      const cellInner = cellMatch[2] ?? "";
      const ref = attr(cellAttrs, "r");
      const type = attr(cellAttrs, "t");
      const col = ref ? columnIndex(ref) : cells.length;

      let value = "";
      if (type === "inlineStr") {
        value = textRuns(cellInner);
      } else if (type === "s") {
        const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellInner);
        const idx = vMatch ? Number(vMatch[1]) : NaN;
        value = Number.isInteger(idx) ? (shared[idx] ?? "") : "";
      } else {
        const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellInner);
        value = vMatch ? decodeEntities(vMatch[1]) : "";
      }
      cells[col] = value;
    }

    rows[rowIndex - 1] = cells;
  }

  // Normalise: fill row/cell gaps so every row is the same width, then drop
  // fully blank rows (matching the CSV parser's behaviour).
  const width = rows.reduce((w, row) => Math.max(w, row?.length ?? 0), 0);
  const normalised: string[][] = [];
  for (let r = 0; r < rows.length; r++) {
    const source = rows[r] ?? [];
    const filled: string[] = [];
    for (let c = 0; c < width; c++) filled.push(source[c] ?? "");
    normalised.push(filled);
  }
  return normalised.filter((row) => row.some((cell) => cell.trim() !== ""));
}

/** Parses the first worksheet of an `.xlsx` file into a string matrix. */
export async function parseXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = await unzip(bytes);
  const decoder = new TextDecoder();

  const sharedPart = files.get("xl/sharedStrings.xml");
  const shared = sharedPart ? parseSharedStrings(decoder.decode(sharedPart)) : [];

  const sheetName = pickSheetPart(files);
  if (!sheetName) return [];

  return parseSheet(decoder.decode(files.get(sheetName)!), shared);
}

/* ── Write ────────────────────────────────────────────────────────────────── */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

function workbookXml(sheetName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

function sheetXml(matrix: string[][]): string {
  const rows = matrix
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnLetter(c)}${r + 1}`;
          if (value === "") return `<c r="${ref}"/>`;
          // Every value is written as an inline string — group codes, dates and
          // labels are all text here, so no shared-string table is needed.
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

/** Serialises a string matrix into a single-sheet `.xlsx` workbook. */
export function matrixToXlsx(
  matrix: string[][],
  sheetName = "Sheet1",
): Uint8Array {
  const encoder = new TextEncoder();
  // Excel truncates sheet names over 31 chars and forbids a few characters.
  const safeName = sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);

  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: encoder.encode(workbookXml(safeName)) },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: encoder.encode(WORKBOOK_RELS),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: encoder.encode(sheetXml(matrix)),
    },
  ]);
}

/* ── File dispatch ────────────────────────────────────────────────────────── */

/**
 * Reads an uploaded spreadsheet into a string matrix, choosing the parser by
 * extension/MIME: `.xlsx` through the workbook reader, `.csv`/`.txt` as text.
 * Legacy binary `.xls` (a different OLE format) is rejected with a clear steer.
 */
export async function readSpreadsheetFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx") || file.type === XLSX_MIME) {
    return parseXlsx(new Uint8Array(await file.arrayBuffer()));
  }
  if (name.endsWith(".xls") || file.type === "application/vnd.ms-excel") {
    // A .csv mislabelled as vnd.ms-excel is common, so fall through to text
    // unless the name really is .xls.
    if (name.endsWith(".xls")) {
      throw new Error(
        "Legacy .xls isn't supported. Save the file as .xlsx or .csv and upload again.",
      );
    }
  }
  return parseCsv(await file.text());
}
