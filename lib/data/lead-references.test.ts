import { describe, expect, it } from "vitest";

import { allocateReferences, formatReference, highestReferenceNumber } from "./lead-references";

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

function fakeDb(options: { rpc: RpcResult; rows?: string[] }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const reads: string[] = [];
  const db = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return options.rpc;
    },
    from: (table: string) => {
      reads.push(table);
      const query = {
        select: () => query,
        like: () => query,
        eq: () => query,
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: (options.rows ?? []).map((reference) => ({ reference })), error: null }),
      };
      return query;
    },
  };
  return { db: db as never, calls, reads };
}

describe("highestReferenceNumber", () => {
  it("reads the highest number of the year and ignores revision suffixes and other years", () => {
    const rows = ["QT-2027-0003", "QT-2027-0011", "QT-2027-0011-R2", "QT-2026-0099", "LD-2027-0500"];
    expect(highestReferenceNumber(rows, "QUOTE", "2027")).toBe(11);
  });

  it("is zero with nothing to continue from", () => {
    expect(highestReferenceNumber([], "LEAD", "2027")).toBe(0);
  });
});

describe("formatReference", () => {
  it("pads to four digits and keeps going past them", () => {
    expect(formatReference("LEAD", "2027", 7)).toBe("LD-2027-0007");
    expect(formatReference("QUOTE", "2027", 12345)).toBe("QT-2027-12345");
  });
});

describe("allocateReferences", () => {
  it("returns what the database issued, in one call for a block", async () => {
    const { db, calls } = fakeDb({ rpc: { data: ["LD-2027-0041", "LD-2027-0042"], error: null } });
    await expect(allocateReferences(db, "LEAD", 2)).resolves.toEqual(["LD-2027-0041", "LD-2027-0042"]);
    expect(calls).toEqual([{ fn: "allocate_references", args: { p_kind: "LEAD", p_count: 2, p_agency_id: null } }]);
  });

  it("passes the agency for service-role callers", async () => {
    const { db, calls } = fakeDb({ rpc: { data: ["LD-2027-0001"], error: null } });
    await allocateReferences(db, "LEAD", 1, { agencyId: "agency-1" });
    expect(calls[0].args).toMatchObject({ p_agency_id: "agency-1" });
  });

  it("falls back to reading existing references while the function is not installed", async () => {
    const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric" }).format(new Date());
    const { db, reads } = fakeDb({
      rpc: { data: null, error: { code: "PGRST202", message: "Could not find the function public.allocate_references" } },
      rows: [`QT-${year}-0004`, `QT-${year}-0009`],
    });
    await expect(allocateReferences(db, "QUOTE", 2)).resolves.toEqual([`QT-${year}-0010`, `QT-${year}-0011`]);
    expect(reads).toEqual(["lead_quotes"]);
  });

  it("does NOT fall back on a real error such as a permission failure", async () => {
    const { db, reads } = fakeDb({ rpc: { data: null, error: { code: "42501", message: "Not allowed to allocate references" } } });
    await expect(allocateReferences(db, "LEAD", 1)).rejects.toMatchObject({ code: "42501" });
    expect(reads).toEqual([]);
  });

  it("returns nothing for a count that is not a positive integer", async () => {
    const { db, calls } = fakeDb({ rpc: { data: [], error: null } });
    await expect(allocateReferences(db, "LEAD", 0)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });
});
