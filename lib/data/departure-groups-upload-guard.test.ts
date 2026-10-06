import { describe, expect, it } from "vitest";

import {
  isPathInPilgrimFolder,
  kindFromFileName,
  parseTravellerFilePath,
  refuseFileOutsidePilgrimFolder,
  sniffUploadKind,
} from "./departure-groups-upload-guard";

const A = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";

const pad = (head: number[]) => Uint8Array.from([...head, ...new Array(16).fill(0)]);

describe("isPathInPilgrimFolder", () => {
  it("accepts a file directly in the traveller's folder", () => {
    expect(isPathInPilgrimFolder(`${A}/${G}/${P}/passport.pdf`, A, G, P)).toBe(true);
  });
  it("refuses another traveller, group or agency", () => {
    expect(isPathInPilgrimFolder(`${A}/${G}/${OTHER}/passport.pdf`, A, G, P)).toBe(false);
    expect(isPathInPilgrimFolder(`${A}/${OTHER}/${P}/passport.pdf`, A, G, P)).toBe(false);
    expect(isPathInPilgrimFolder(`${OTHER}/${G}/${P}/passport.pdf`, A, G, P)).toBe(false);
  });
  it("refuses nested paths, traversal and an empty file name", () => {
    expect(isPathInPilgrimFolder(`${A}/${G}/${P}/sub/x.pdf`, A, G, P)).toBe(false);
    expect(isPathInPilgrimFolder(`${A}/${G}/${P}/..x.pdf`, A, G, P)).toBe(false);
    expect(isPathInPilgrimFolder(`${A}/${G}/${P}/`, A, G, P)).toBe(false);
  });
});

describe("parseTravellerFilePath", () => {
  it("returns the owner ids for the caller's own agency", () => {
    expect(parseTravellerFilePath(`${A}/${G}/${P}/a.pdf`, A)).toEqual({
      ok: true,
      agencyId: A,
      groupId: G,
      pilgrimId: P,
    });
    expect(parseTravellerFilePath(`${A}/${G}/_ticket-intake/a.pdf`, A)).toMatchObject({ ok: true, pilgrimId: null });
  });
  it("refuses another agency, odd shapes and traversal", () => {
    expect(parseTravellerFilePath(`${OTHER}/${G}/${P}/a.pdf`, A).ok).toBe(false);
    expect(parseTravellerFilePath(`${A}/${G}/a.pdf`, A).ok).toBe(false);
    expect(parseTravellerFilePath(`${A}/${G}/${P}/../x.pdf`, A).ok).toBe(false);
    expect(parseTravellerFilePath(`${A}/not-a-uuid/${P}/a.pdf`, A).ok).toBe(false);
  });
});

describe("sniffUploadKind", () => {
  it("identifies each allowed type by its bytes", () => {
    expect(sniffUploadKind(pad([0x25, 0x50, 0x44, 0x46]))).toBe("pdf");
    expect(sniffUploadKind(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffUploadKind(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffUploadKind(Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]))).toBe("webp");
    expect(sniffUploadKind(Uint8Array.from([0, 0, 0, 24, ...Buffer.from("ftypheic")]))).toBe("heic");
  });
  it("rejects executables, scripts and short files", () => {
    expect(sniffUploadKind(pad([0x4d, 0x5a]))).toBeNull(); // MZ
    expect(sniffUploadKind(Uint8Array.from(Buffer.from("<script>alert(1)</script>")))).toBeNull();
    expect(sniffUploadKind(Uint8Array.from([0x25, 0x50]))).toBeNull();
  });
});

describe("kindFromFileName", () => {
  it("reads the extension the server wrote", () => {
    expect(kindFromFileName("x.pdf")).toBe("pdf");
    expect(kindFromFileName("x.exe")).toBeNull();
  });
});

describe("refuseFileOutsidePilgrimFolder", () => {
  it("allows no file, and a file in the traveller's own folder", () => {
    expect(refuseFileOutsidePilgrimFolder(null, A, G, P)).toBeNull();
    expect(refuseFileOutsidePilgrimFolder("  ", A, G, P)).toBeNull();
    expect(refuseFileOutsidePilgrimFolder(`${A}/${G}/${P}/a.pdf`, A, G, P)).toBeNull();
  });
  it("refuses another traveller's file and any file when the agency is unknown", () => {
    expect(refuseFileOutsidePilgrimFolder(`${A}/${G}/${OTHER}/a.pdf`, A, G, P)).not.toBeNull();
    expect(refuseFileOutsidePilgrimFolder(`${A}/${G}/${P}/a.pdf`, null, G, P)).not.toBeNull();
  });
});
