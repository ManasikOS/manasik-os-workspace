import { describe, expect, it, vi } from "vitest";

import { provisionAgencyForSignup } from "./provision-signup";

type Row = { id: string } | null;

function fakeAdminClient(opts: { pending: Row; rpc?: { data: string | null; error: { message: string } | null } }) {
  const eq = vi.fn();
  const chain = {
    select: vi.fn(() => chain),
    eq: (...args: unknown[]) => {
      eq(...args);
      return chain;
    },
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: opts.pending, error: null })),
  };
  const rpc = vi.fn(async () => opts.rpc ?? { data: "agency-1", error: null });
  return { client: { from: vi.fn(() => chain), rpc } as never, rpc, eq };
}

describe("provisionAgencyForSignup", () => {
  it("looks the pending row up by exact, lower-cased email", async () => {
    const { client, eq } = fakeAdminClient({ pending: { id: "p1" } });
    await provisionAgencyForSignup(client, { userId: "u1", email: "Owner@Agency.COM" });
    expect(eq).toHaveBeenCalledWith("email", "owner@agency.com");
  });

  it("provisions through the atomic RPC and returns the agency id", async () => {
    const { client, rpc } = fakeAdminClient({ pending: { id: "p1" } });
    const result = await provisionAgencyForSignup(client, { userId: "u1", email: "o@a.com" });
    expect(rpc).toHaveBeenCalledWith("provision_agency_from_signup", { p_pending_id: "p1", p_user_id: "u1", p_email: "o@a.com" });
    expect(result).toEqual({ kind: "provisioned", agencyId: "agency-1" });
  });

  it("reports no signup when nothing is staged for the email", async () => {
    const { client, rpc } = fakeAdminClient({ pending: null });
    expect(await provisionAgencyForSignup(client, { userId: "u1", email: "o@a.com" })).toEqual({ kind: "no_signup" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an expired signup to a start-again outcome", async () => {
    const { client } = fakeAdminClient({ pending: { id: "p1" }, rpc: { data: null, error: { message: "pending_signup_expired" } } });
    expect(await provisionAgencyForSignup(client, { userId: "u1", email: "o@a.com" })).toEqual({ kind: "expired" });
  });

  it("maps any other failure to a retryable outcome without leaking the database message", async () => {
    const { client } = fakeAdminClient({ pending: { id: "p1" }, rpc: { data: null, error: { message: "deadlock detected" } } });
    expect(await provisionAgencyForSignup(client, { userId: "u1", email: "o@a.com" })).toEqual({ kind: "failed" });
  });

  it("is safe to call twice: both calls resolve to the same agency", async () => {
    const { client, rpc } = fakeAdminClient({ pending: { id: "p1" } });
    const first = await provisionAgencyForSignup(client, { userId: "u1", email: "o@a.com" });
    const second = await provisionAgencyForSignup(client, { userId: "u1", email: "o@a.com" });
    expect(first).toEqual(second);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
