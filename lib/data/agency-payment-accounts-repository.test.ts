import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { accountDigitsOf, addApprovedPaymentAccount, approvedPaymentAccountInputSchema, listApprovedPaymentAccounts, setApprovedPaymentAccountActive } = await import("./agency-payment-accounts-repository");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAFF = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACCOUNT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Call = { method: string; args: unknown[] };
function recorder(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = new Proxy({}, {
    get: (_target, method: string) => {
      if (method === "then") return (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (method === "maybeSingle") return async () => result;
      return (...args: unknown[]) => { calls.push({ method, args }); return builder; };
    },
  });
  return { db: { from: (table: string) => { calls.push({ method: "from", args: [table] }); return builder; } } as never, calls };
}

describe("approved payment account input", () => {
  it("keeps digits only, so spaced and unspaced numbers are the same account", () => {
    expect(accountDigitsOf("1234 5678-90")).toBe("1234567890");
    expect(approvedPaymentAccountInputSchema.parse({ label: "Main", accountNumber: "1234 5678" }).accountNumber).toBe("12345678");
  });

  it("rejects a number that is too short or too long, and a blank name", () => {
    expect(approvedPaymentAccountInputSchema.safeParse({ label: "Main", accountNumber: "12345" }).success).toBe(false);
    expect(approvedPaymentAccountInputSchema.safeParse({ label: "Main", accountNumber: "1".repeat(21) }).success).toBe(false);
    expect(approvedPaymentAccountInputSchema.safeParse({ label: "  ", accountNumber: "12345678" }).success).toBe(false);
  });
});

describe("approved payment account repository", () => {
  it("never returns a full account number — only the last four digits", async () => {
    const { db, calls } = recorder({ data: [{ id: ACCOUNT, label: "Main", bank_name: "BOC", account_digits: "1234567890", active: true, created_at: "2026-09-21" }], error: null });
    const [account] = await listApprovedPaymentAccounts(db, AGENCY);
    expect(account.maskedAccount).toBe("•••• 7890");
    expect(JSON.stringify(account)).not.toContain("1234567890");
    expect(calls.some((call) => call.method === "eq" && call.args[0] === "agency_id" && call.args[1] === AGENCY)).toBe(true);
  });

  it("adds an account for the caller's agency with the creator recorded", async () => {
    const { db, calls } = recorder({ data: null, error: null });
    await addApprovedPaymentAccount(db, AGENCY, STAFF, { label: "Main", bankName: "BOC", accountNumber: "12345678" });
    expect(calls.find((call) => call.method === "insert")?.args[0]).toEqual({ agency_id: AGENCY, label: "Main", bank_name: "BOC", account_digits: "12345678", created_by: STAFF });
  });

  it("explains a duplicate account plainly", async () => {
    const { db } = recorder({ data: null, error: { code: "23505", message: "duplicate key" } });
    await expect(addApprovedPaymentAccount(db, AGENCY, STAFF, { label: "Main", bankName: "", accountNumber: "12345678" })).rejects.toThrow("already on the list");
  });

  it("switches an account off within the agency, and refuses one that is not there", async () => {
    const found = recorder({ data: { id: ACCOUNT }, error: null });
    await setApprovedPaymentAccountActive(found.db, AGENCY, ACCOUNT, false);
    expect(found.calls.find((call) => call.method === "update")?.args[0]).toEqual({ active: false });
    expect(found.calls.some((call) => call.method === "eq" && call.args[0] === "agency_id" && call.args[1] === AGENCY)).toBe(true);
    const missing = recorder({ data: null, error: null });
    await expect(setApprovedPaymentAccountActive(missing.db, AGENCY, ACCOUNT, true)).rejects.toThrow("could not be found");
  });
});
