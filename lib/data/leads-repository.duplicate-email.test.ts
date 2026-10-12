import { describe, expect, it } from "vitest";

import { findDuplicateLeadSummary, type Db } from "./leads-repository";

/**
 * LD-18: the duplicate check compared e-mail with `ilike`, and PostgREST reads `*` in an ilike pattern as a wildcard, so typing `*` matched the first
 * lead on file (and returned its name, number and owner). It now compares the stored, lower-cased column for equality.
 */

interface Call {
  method: "eq" | "ilike";
  column: string;
  value: string;
}

function fakeDb(options: { normalisedColumnExists: boolean; rows?: Array<Record<string, unknown>> }) {
  const calls: Call[] = [];
  const db = {
    from: () => ({
      select: () => {
        let call: Call | null = null;
        const query: Record<string, unknown> = {};
        query.eq = (column: string, value: string) => {
          call = { method: "eq", column, value };
          calls.push(call);
          return query;
        };
        query.ilike = (column: string, value: string) => {
          call = { method: "ilike", column, value };
          calls.push(call);
          return query;
        };
        query.limit = async () => {
          if (call?.column === "email_normalised" && !options.normalisedColumnExists) {
            return { data: null, error: { code: "42703", message: 'column "email_normalised" does not exist' } };
          }
          return { data: options.rows ?? [], error: null };
        };
        return query;
      },
    }),
  } as unknown as Db;
  return { db, calls };
}

const ROW = {
  id: "lead-1",
  reference: "LD-2027-0001",
  full_name: "Ayesha",
  mobile: "771234567",
  email: "Ayesha@Example.com",
  stage: "NEW_LEAD",
  assigned_to_name: "Amina",
  interested_in: "Umrah",
};

describe("findDuplicateLeadSummary by e-mail", () => {
  it("compares the lower-cased e-mail for equality", async () => {
    const { db, calls } = fakeDb({ normalisedColumnExists: true, rows: [ROW] });
    const found = await findDuplicateLeadSummary(db, "", "  Ayesha@Example.COM ");

    expect(found).toMatchObject({ matchedOn: "email", lead: { reference: "LD-2027-0001" } });
    expect(calls).toEqual([{ method: "eq", column: "email_normalised", value: "ayesha@example.com" }]);
  });

  it("treats a wildcard as the literal text it is", async () => {
    const { db, calls } = fakeDb({ normalisedColumnExists: true, rows: [] });
    expect(await findDuplicateLeadSummary(db, "", "*")).toBeNull();
    expect(calls[0]).toEqual({ method: "eq", column: "email_normalised", value: "*" });
  });

  it("falls back to an escaped pattern match until the column exists", async () => {
    const { db, calls } = fakeDb({ normalisedColumnExists: false, rows: [] });
    await findDuplicateLeadSummary(db, "", "a*b%c_d@x.io");

    expect(calls[1]).toEqual({ method: "ilike", column: "email", value: "a\\*b\\%c\\_d@x.io" });
  });

  it("does not look up an empty e-mail", async () => {
    const { db, calls } = fakeDb({ normalisedColumnExists: true });
    expect(await findDuplicateLeadSummary(db, "", "   ")).toBeNull();
    expect(calls).toEqual([]);
  });
});
