import { deflateRawSync, deflateSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  inspectOoxml,
  inspectPdf,
  inspectStagedFileContent,
  OFFICE_MACRO_MESSAGE,
  OFFICE_NOT_OFFICE_MESSAGE,
  OFFICE_UNCHECKABLE_MESSAGE,
  PDF_ENCRYPTED_MESSAGE,
  PDF_SCRIPT_MESSAGE,
  PDF_UNCHECKABLE_MESSAGE,
} from "./file-inspection";

/**
 * SEC-8 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): the first pass searched raw bytes for `/JavaScript` and `/Launch`, and for
 * `vbaProject.bin`. A PDF defeats that with `/Java#53cript`, `/JS`, `/EmbeddedFile`, or by keeping its dictionaries in a compressed object stream;
 * and any ZIP passed as a Word, Excel or PowerPoint file. These tests build real files of each kind, including the evasions, and benign files that
 * must still go through.
 */

/* ── PDF builders ─────────────────────────────────────────────────────────── */

const latin1 = (text: string) => Buffer.from(text, "latin1");

/** A small but structurally ordinary PDF, plus whatever extra objects the test needs. */
function pdf(extraObjects = ""): Uint8Array {
  return new Uint8Array(latin1(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n${extraObjects}trailer\n<< /Root 1 0 R >>\n%%EOF\n`));
}

/** A PDF whose dictionaries live in a compressed object stream, as every modern PDF writer produces. */
function pdfWithObjectStream(hiddenDictionaries: string, filterEntry = "/Filter /FlateDecode"): Uint8Array {
  const body = deflateSync(latin1(`5 0 ${hiddenDictionaries}`));
  return new Uint8Array(
    Buffer.concat([
      latin1(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n6 0 obj\n<< /Type /ObjStm /N 1 /First 4 ${filterEntry} /Length ${body.byteLength} >>\nstream\n`),
      body,
      latin1("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"),
    ]),
  );
}

describe("inspectPdf — what must be refused", () => {
  it("accepts an ordinary PDF", () => {
    expect(inspectPdf(pdf())).toEqual({ ok: true });
  });

  it("refuses the plain forms of a script and a launch action", () => {
    expect(inspectPdf(pdf("3 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\n"))).toEqual({ ok: false, error: PDF_SCRIPT_MESSAGE });
    expect(inspectPdf(pdf("3 0 obj\n<< /S /Launch /F (cmd.exe) >>\nendobj\n"))).toEqual({ ok: false, error: PDF_SCRIPT_MESSAGE });
  });

  it("refuses a script whose name is spelled with # escapes: /Java#53cript, /La#75nch, /#4A#61va#53cript", () => {
    for (const evasion of ["/S /Java#53cript", "/S /La#75nch", "/S /#4A#61va#53cript", "/S /Java#53cript /JS (x)"]) {
      expect(inspectPdf(pdf(`3 0 obj\n<< ${evasion} >>\nendobj\n`)), evasion).toEqual({ ok: false, error: PDF_SCRIPT_MESSAGE });
    }
  });

  it("refuses the other keys that run code or carry something else: /EmbeddedFile, /RichMedia, /XFA, /SubmitForm, /ImportData, /GoToR", () => {
    for (const key of ["/EmbeddedFile", "/EmbeddedFiles", "/RichMedia", "/XFA", "/S /SubmitForm", "/S /ImportData", "/S /GoToR", "/S /GoToE"]) {
      expect(inspectPdf(pdf(`3 0 obj\n<< ${key} >>\nendobj\n`)), key).toEqual({ ok: false, error: PDF_SCRIPT_MESSAGE });
    }
  });

  it("refuses a script hidden inside a compressed object stream, which a search of the raw bytes never sees", () => {
    const hidden = pdfWithObjectStream("<< /S /JavaScript /JS (app.alert(1)) >>");
    expect(Buffer.from(hidden).includes("JavaScript")).toBe(false);
    expect(inspectPdf(hidden)).toEqual({ ok: false, error: PDF_SCRIPT_MESSAGE });
  });

  it("refuses a script that is both compressed and spelled with # escapes", () => {
    expect(inspectPdf(pdfWithObjectStream("<< /S /Java#53cript >>"))).toEqual({ ok: false, error: PDF_SCRIPT_MESSAGE });
  });

  it("refuses a PDF whose object stream is compressed in a way that cannot be unpacked, rather than guessing it is safe", () => {
    expect(inspectPdf(pdfWithObjectStream("<< /Type /Page >>", "/Filter [/ASCII85Decode /FlateDecode]"))).toEqual({ ok: false, error: PDF_UNCHECKABLE_MESSAGE });
    expect(inspectPdf(pdfWithObjectStream("<< /Type /Page >>", "/Filter /LZWDecode"))).toEqual({ ok: false, error: PDF_UNCHECKABLE_MESSAGE });
  });

  it("refuses an object stream that does not decompress", () => {
    const broken = new Uint8Array(latin1("%PDF-1.7\n6 0 obj\n<< /Type /ObjStm /Filter /FlateDecode >>\nstream\nthis is not zlib data\nendstream\nendobj\n"));
    expect(inspectPdf(broken)).toEqual({ ok: false, error: PDF_UNCHECKABLE_MESSAGE });
  });

  it("refuses a decompression bomb instead of inflating it", () => {
    const bomb = deflateSync(Buffer.alloc(40 * 1024 * 1024, 0x20));
    expect(bomb.byteLength).toBeLessThan(200_000);
    const file = new Uint8Array(Buffer.concat([latin1("%PDF-1.7\n6 0 obj\n<< /Type /ObjStm /Filter /FlateDecode >>\nstream\n"), bomb, latin1("\nendstream\nendobj\n")]));
    expect(inspectPdf(file)).toEqual({ ok: false, error: PDF_UNCHECKABLE_MESSAGE });
  });

  it("refuses a password-protected PDF, whose contents cannot be looked at", () => {
    expect(inspectPdf(pdf("trailer\n<< /Encrypt 9 0 R /Root 1 0 R >>\n"))).toEqual({ ok: false, error: PDF_ENCRYPTED_MESSAGE });
  });
});

describe("inspectPdf — what must still go through", () => {
  it("does not refuse a large PDF because its compressed image data happens to contain the bytes of a short key", () => {
    // 9 MB of pseudo-random bytes (a fixed sequence, so this never flakes) is what compressed image data looks like to a byte search.
    let state = 123456789;
    const noise = Buffer.alloc(9 * 1024 * 1024);
    for (let index = 0; index < noise.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      noise[index] = state >>> 24;
    }
    // Plant the exact bytes that used to be refused, as they could appear by chance in real data.
    Buffer.from("/JS (").copy(noise, 1_000_000);
    Buffer.from("/JS ").copy(noise, 5_000_000);
    const head = latin1("%PDF-1.7\n4 0 obj\n<< /Length 9437184 /Filter /DCTDecode >>\nstream\n");
    const tail = latin1("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
    expect(inspectPdf(new Uint8Array(Buffer.concat([head, noise, tail])))).toEqual({ ok: true });
  });

  it("does not treat a bare /JS as proof of a script: a script action cannot run without /JavaScript, which is what is refused", () => {
    expect(inspectPdf(pdf("3 0 obj\n<< /JS (x) >>\nendobj\n"))).toEqual({ ok: true });
  });

  it("accepts a PDF whose compressed object stream holds ordinary dictionaries", () => {
    expect(inspectPdf(pdfWithObjectStream("<< /Type /Page /MediaBox [0 0 612 792] >>"))).toEqual({ ok: true });
  });

  it("accepts a PDF with an /OpenAction that only opens a page (common in ordinary PDFs), and one with a link", () => {
    expect(inspectPdf(pdf("3 0 obj\n<< /OpenAction [4 0 R /Fit] >>\nendobj\n"))).toEqual({ ok: true });
    expect(inspectPdf(pdf("3 0 obj\n<< /S /URI /URI (https://example.com) >>\nendobj\n"))).toEqual({ ok: true });
  });

  it("does not mistake a longer name for a blocked one: /JSON, /JavaScripts, /Launcher", () => {
    expect(inspectPdf(pdf("3 0 obj\n<< /JSON 1 /Launcher 2 /JavaScripts 3 >>\nendobj\n"))).toEqual({ ok: true });
  });

  it("does not mistake the words in page text for keys: the key must be a name starting with a slash", () => {
    expect(inspectPdf(pdf("4 0 obj\n<< /Length 40 >>\nstream\nBT (Embedded File and JavaScript guide) Tj ET\nendstream\nendobj\n"))).toEqual({ ok: true });
  });

  it("accepts a PDF with an uncompressed object stream", () => {
    const plain = new Uint8Array(latin1("%PDF-1.7\n6 0 obj\n<< /Type /ObjStm /N 1 /First 4 >>\nstream\n5 0 << /Type /Page >>\nendstream\nendobj\n"));
    expect(inspectPdf(plain)).toEqual({ ok: true });
  });
});

/* ── ZIP / Office builders ────────────────────────────────────────────────── */

interface ZipPart {
  name: string;
  content: string;
  /** Store the part uncompressed (method 0) instead of deflating it (method 8). */
  stored?: boolean;
  flags?: number;
}

function u16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}
function u32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

/** A real ZIP: local headers, a central directory and an end record. */
function zip(parts: ZipPart[], options: { comment?: string } = {}): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name, "utf8");
    const raw = Buffer.from(part.content, "utf8");
    const method = part.stored ? 0 : 8;
    const data = part.stored ? raw : deflateRawSync(raw);
    const flags = part.flags ?? 0;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(0), u32(data.byteLength), u32(raw.byteLength), u16(name.byteLength), u16(0), name, data]);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(0), u32(data.byteLength), u32(raw.byteLength), u16(name.byteLength), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    locals.push(local);
    offset += local.byteLength;
  }
  const directory = Buffer.concat(centrals);
  const comment = Buffer.from(options.comment ?? "", "utf8");
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(parts.length), u16(parts.length), u32(directory.byteLength), u32(offset), u16(comment.byteLength), comment]);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const CONTENT_TYPES = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

/** A minimal but genuine-looking Word file. */
const docxParts = (extra: ZipPart[] = [], contentTypes = CONTENT_TYPES): ZipPart[] => [
  { name: "[Content_Types].xml", content: contentTypes },
  { name: "_rels/.rels", content: "<Relationships/>" },
  { name: "word/document.xml", content: "<w:document/>" },
  ...extra,
];

describe("inspectOoxml — what must be refused", () => {
  it("accepts a genuine Word file", () => {
    expect(inspectOoxml(zip(docxParts()), "docx")).toEqual({ ok: true });
  });

  it("refuses a macro, however the part is cased or placed", () => {
    for (const name of ["word/vbaProject.bin", "word/VBAPROJECT.BIN", "xl/vbaProject.bin", "other/dir/vbaproject.bin"]) {
      expect(inspectOoxml(zip(docxParts([{ name, content: "x" }])), "docx"), name).toEqual({ ok: false, error: OFFICE_MACRO_MESSAGE });
    }
  });

  it("refuses Excel 4.0 macro sheets, ActiveX controls and embedded objects", () => {
    for (const name of ["xl/macrosheets/sheet1.xml", "word/activeX/activeX1.xml", "word/embeddings/oleObject1.bin", "ppt/embeddings/Microsoft_Excel_Sheet1.xlsx"]) {
      expect(inspectOoxml(zip(docxParts([{ name, content: "x" }])), "docx"), name).toEqual({ ok: false, error: OFFICE_MACRO_MESSAGE });
    }
  });

  it("refuses a program or script carried as a part, whatever folder it is in", () => {
    for (const name of ["word/media/setup.exe", "word/payload.js", "docProps/run.vbs", "word/tool.dll", "word/a.ps1", "word/x.hta"]) {
      expect(inspectOoxml(zip(docxParts([{ name, content: "x" }])), "docx"), name).toEqual({ ok: false, error: OFFICE_MACRO_MESSAGE });
    }
  });

  it("refuses a macro-enabled file by its declared content type, even if the parts are named oddly", () => {
    const macroTypes = CONTENT_TYPES.replace("document.main+xml", "document.macroEnabled.main+xml");
    expect(inspectOoxml(zip(docxParts([], macroTypes)), "docx")).toEqual({ ok: false, error: OFFICE_MACRO_MESSAGE });
    const vbaType = CONTENT_TYPES.replace("</Types>", `<Override PartName="/word/odd.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>`);
    expect(inspectOoxml(zip(docxParts([], vbaType)), "docx")).toEqual({ ok: false, error: OFFICE_MACRO_MESSAGE });
  });

  it("reads the content types whether the part is stored or compressed", () => {
    const macroTypes = CONTENT_TYPES.replace("document.main+xml", "document.macroEnabled.main+xml");
    const parts = docxParts([], macroTypes).map((part) => (part.name === "[Content_Types].xml" ? { ...part, stored: true } : part));
    expect(inspectOoxml(zip(parts), "docx")).toEqual({ ok: false, error: OFFICE_MACRO_MESSAGE });
  });

  it("refuses an ordinary ZIP that is not an Office file at all, which used to pass as a Word file", () => {
    expect(inspectOoxml(zip([{ name: "readme.txt", content: "hello" }]), "docx")).toEqual({ ok: false, error: OFFICE_NOT_OFFICE_MESSAGE });
    expect(inspectOoxml(zip([{ name: "classes/Main.class", content: "x" }, { name: "META-INF/MANIFEST.MF", content: "x" }]), "docx")).toEqual({ ok: false, error: OFFICE_NOT_OFFICE_MESSAGE });
  });

  it("refuses a file of the wrong Office kind: an Excel workbook sent as a Word file, and the reverse", () => {
    const xlsx = zip([{ name: "[Content_Types].xml", content: CONTENT_TYPES }, { name: "xl/workbook.xml", content: "<workbook/>" }]);
    expect(inspectOoxml(xlsx, "docx")).toEqual({ ok: false, error: OFFICE_NOT_OFFICE_MESSAGE });
    expect(inspectOoxml(xlsx, "xlsx")).toEqual({ ok: true });
    expect(inspectOoxml(zip(docxParts()), "xlsx")).toEqual({ ok: false, error: OFFICE_NOT_OFFICE_MESSAGE });
  });

  it("refuses bytes that start like a ZIP but are not one", () => {
    expect(inspectOoxml(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]), "docx")).toEqual({ ok: false, error: OFFICE_NOT_OFFICE_MESSAGE });
  });

  it("refuses an encrypted entry, which cannot be looked at", () => {
    expect(inspectOoxml(zip(docxParts([{ name: "word/secret.xml", content: "x", flags: 1 }])), "docx")).toEqual({ ok: false, error: OFFICE_UNCHECKABLE_MESSAGE });
  });

  it("refuses a ZIP that claims to unpack to an enormous size", () => {
    const bytes = zip(docxParts());
    // Rewrite the first central-directory entry's uncompressed size to 200 MB.
    const buffer = Buffer.from(bytes);
    const directoryStart = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buffer.writeUInt32LE(200 * 1024 * 1024, directoryStart + 24);
    expect(inspectOoxml(new Uint8Array(buffer), "docx")).toEqual({ ok: false, error: OFFICE_UNCHECKABLE_MESSAGE });
  });

  it("refuses ZIP64 files, which it does not read", () => {
    const buffer = Buffer.from(zip(docxParts()));
    const endAt = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    buffer.writeUInt16LE(0xffff, endAt + 10);
    expect(inspectOoxml(new Uint8Array(buffer), "docx")).toEqual({ ok: false, error: OFFICE_UNCHECKABLE_MESSAGE });
  });

  it("finds the central directory even when the ZIP ends with a comment", () => {
    expect(inspectOoxml(zip(docxParts(), { comment: "made by a tool" }), "docx")).toEqual({ ok: true });
  });
});

describe("inspectStagedFileContent", () => {
  it("routes each type to its own check, and lets a photo through, since a photo has no deep check", () => {
    expect(inspectStagedFileContent({ mimeType: "application/pdf", bytes: pdf("3 0 obj\n<< /S /Launch >>\nendobj\n") })).toMatchObject({ ok: false });
    expect(inspectStagedFileContent({ mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: zip(docxParts()) })).toEqual({ ok: true });
    expect(inspectStagedFileContent({ mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: zip(docxParts()) })).toMatchObject({ ok: false });
    expect(inspectStagedFileContent({ mimeType: "image/png", bytes: new Uint8Array([0x89, 0x50]) })).toEqual({ ok: true });
  });

  it("accepts the type in any letter case", () => {
    expect(inspectStagedFileContent({ mimeType: "Application/PDF", bytes: pdf() })).toEqual({ ok: true });
  });
});
