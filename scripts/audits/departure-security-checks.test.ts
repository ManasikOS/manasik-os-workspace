import { describe, expect, it } from "vitest";

import {
  FAIL,
  PASS,
  SKIP,
  errorCode,
  exitCodeFor,
  foreignAgencyRows,
  insertOutcome,
  looksLikeProduction,
  result,
  summarise,
  valuesOutside,
  writeWasRefused,
} from "./departure-security-checks.mjs";

describe("foreignAgencyRows", () => {
  it("returns only rows from another agency, or with none", () => {
    const rows = [{ agency_id: "a" }, { agency_id: "b" }, { agency_id: null }, {}];
    expect(foreignAgencyRows(rows, "a")).toEqual([{ agency_id: "b" }, { agency_id: null }, {}]);
  });
  it("is empty when everything belongs to the caller, and tolerates no rows", () => {
    expect(foreignAgencyRows([{ agency_id: "a" }], "a")).toEqual([]);
    expect(foreignAgencyRows(null, "a")).toEqual([]);
  });
});

describe("valuesOutside", () => {
  it("lists values not in the allowed set", () => {
    expect(valuesOutside([{ id: "1" }, { id: "2" }, { id: "3" }], "id", new Set(["1", "3"]))).toEqual(["2"]);
  });
});

describe("writeWasRefused", () => {
  it("counts an error as a refusal", () => {
    expect(writeWasRefused({ error: { code: "42501" }, rowsAffected: null })).toBe(true);
  });
  it("counts a call that changed no rows as a refusal (row-level security hides the row)", () => {
    expect(writeWasRefused({ error: null, rowsAffected: [] })).toBe(true);
  });
  it("does NOT count a write that changed a row as refused", () => {
    expect(writeWasRefused({ error: null, rowsAffected: [{ id: "x" }] })).toBe(false);
  });
  it("does not assume a refusal when it cannot tell", () => {
    expect(writeWasRefused({ error: null, rowsAffected: null })).toBe(false);
  });
});

describe("errorCode", () => {
  it("reads a string code and ignores anything else", () => {
    expect(errorCode({ code: "40001" })).toBe("40001");
    expect(errorCode({ code: 5 })).toBeNull();
    expect(errorCode(null)).toBeNull();
  });
});

describe("looksLikeProduction", () => {
  it("flags production-looking hosts and unparseable URLs", () => {
    expect(looksLikeProduction("https://abc.supabase.co/rest")).toBe(false);
    expect(looksLikeProduction("https://crm-prod.supabase.co")).toBe(true);
    expect(looksLikeProduction("https://db.production.example.com")).toBe(true);
    expect(looksLikeProduction("not a url")).toBe(true);
  });
  it("honours an explicit production host pattern", () => {
    expect(looksLikeProduction("https://xyzcompany.supabase.co", { CHECK_PRODUCTION_HOST_PATTERN: "^xyzcompany\\." })).toBe(true);
  });
});

describe("results", () => {
  const rows = [result("T1", "a", PASS), result("T2", "b", SKIP, "no data"), result("T3", "c", FAIL, "1 foreign row")];
  it("summarises and exits non-zero on any failure", () => {
    expect(summarise(rows)).toEqual({ pass: 1, fail: 1, skip: 1 });
    expect(exitCodeFor(rows)).toBe(1);
  });
  it("exits zero when nothing failed, even with skips", () => {
    expect(exitCodeFor(rows.filter((r) => r.status !== FAIL))).toBe(0);
  });
});

describe("insertOutcome", () => {
  it("passes only when row-level security refused it", () => {
    expect(insertOutcome({ error: { code: "42501" }, rowsCreated: null }).status).toBe("PASS");
  });
  it("fails when a row was created", () => {
    expect(insertOutcome({ error: null, rowsCreated: [{ id: "x" }] }).status).toBe("FAIL");
  });
  it("does not count an unrelated error (bad payload, missing column) as a security pass", () => {
    expect(insertOutcome({ error: { code: "23502" }, rowsCreated: null }).status).toBe("SKIP");
    expect(insertOutcome({ error: { message: "boom" }, rowsCreated: null }).status).toBe("SKIP");
  });
  it("does not guess when nothing came back", () => {
    expect(insertOutcome({ error: null, rowsCreated: [] }).status).toBe("SKIP");
  });
});
