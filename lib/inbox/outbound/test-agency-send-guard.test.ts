import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@/lib/ai/db";
import { loadAgencyIsTest, TEST_AGENCY_SEND_REFUSAL, testAgencySendRefusal } from "./test-agency-send-guard";

function dbReturning(result: { data: { is_test: boolean } | null; error: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder = {
    select: (...args: unknown[]) => (calls.push(["select", ...args]), builder),
    eq: (...args: unknown[]) => (calls.push(["eq", ...args]), builder),
    maybeSingle: async () => result,
  };
  return { db: { from: (table: string) => (calls.push(["from", table]), builder) } as unknown as Db, calls };
}

describe("loadAgencyIsTest", () => {
  it("reads the flag for exactly the agency asked about", async () => {
    const { db, calls } = dbReturning({ data: { is_test: true }, error: null });
    await expect(loadAgencyIsTest(db, "agency-1")).resolves.toBe(true);
    expect(calls).toContainEqual(["from", "agencies"]);
    expect(calls).toContainEqual(["eq", "id", "agency-1"]);
  });

  it("answers false for a normal agency", async () => {
    const { db } = dbReturning({ data: { is_test: false }, error: null });
    await expect(loadAgencyIsTest(db, "agency-1")).resolves.toBe(false);
  });

  it("throws, instead of answering false, when the read fails or the agency is unknown", async () => {
    await expect(loadAgencyIsTest(dbReturning({ data: null, error: { message: "boom" } }).db, "a")).rejects.toThrow(/boom/);
    await expect(loadAgencyIsTest(dbReturning({ data: null, error: null }).db, "a")).rejects.toThrow(/not found/);
  });
});

describe("testAgencySendRefusal", () => {
  it("refuses a test agency", async () => {
    expect(await testAgencySendRefusal(dbReturning({ data: { is_test: true }, error: null }).db, "a")).toBe(TEST_AGENCY_SEND_REFUSAL);
  });

  it("allows a normal agency", async () => {
    expect(await testAgencySendRefusal(dbReturning({ data: { is_test: false }, error: null }).db, "a")).toBeNull();
  });

  it("refuses when the flag cannot be read, so an uncertain send never goes out", async () => {
    const refusal = await testAgencySendRefusal(dbReturning({ data: null, error: { message: "db down" } }).db, "a");
    expect(refusal).toMatch(/nothing was sent/);
  });
});
