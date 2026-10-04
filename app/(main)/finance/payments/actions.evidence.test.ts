import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FIN-05: the evidence review actions authenticate, authorise by role, validate with Zod and scope to the caller's
 * agency before the repository is touched. The repository is replaced; the gates and schemas are the real ones.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/utils/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/data/finance-repository", () => ({}));
vi.mock("@/lib/data/reconciliation-repository", () => ({}));
vi.mock("@/lib/ai/surfaces/reconciliation/workflows", () => ({}));
vi.mock("@/app/(main)/suppliers/actions", () => ({}));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVIDENCE = "30000000-0000-4000-8000-000000000003";
const PAYMENT = "40000000-0000-4000-8000-000000000004";

const session = { role: "FINANCE" as string, agencyId: AGENCY as string | null, authenticated: true };
const requireUser = vi.fn(async () => {
  if (!session.authenticated) throw new Error("NEXT_REDIRECT");
  return { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
});
vi.mock("@/lib/dal", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role: session.role, agencyId: session.agencyId, name: "Amina" }),
}));

const repository = {
  listUnmatchedEvidenceWithCandidates: vi.fn(),
  matchEvidenceToPayment: vi.fn(),
  dismissFinanceEvidence: vi.fn(),
};
vi.mock("@/lib/data/finance-evidence-repository", () => ({
  createSupabaseFinanceEvidenceRepository: () => repository,
}));

import {
  dismissFinanceEvidenceAction,
  loadFinanceEvidenceIntakeAction,
  matchFinanceEvidenceAction,
} from "./actions";

beforeEach(() => {
  session.role = "FINANCE";
  session.agencyId = AGENCY;
  session.authenticated = true;
  vi.clearAllMocks();
  repository.listUnmatchedEvidenceWithCandidates.mockResolvedValue([]);
  repository.matchEvidenceToPayment.mockResolvedValue({ ok: true, status: "MATCHED_TO_PAYMENT", paymentId: PAYMENT });
  repository.dismissFinanceEvidence.mockResolvedValue({ ok: true, status: "DISMISSED", paymentId: null });
});

describe("loadFinanceEvidenceIntakeAction", () => {
  it("authenticates first and never reaches the repository when the session fails", async () => {
    session.authenticated = false;
    await expect(loadFinanceEvidenceIntakeAction()).rejects.toThrow("NEXT_REDIRECT");
    expect(repository.listUnmatchedEvidenceWithCandidates).not.toHaveBeenCalled();
  });

  it("denies roles without Finance review access", async () => {
    for (const role of ["OPERATIONS", "MARKETING", "VISA", "GUIDE"]) {
      session.role = role;
      const result = await loadFinanceEvidenceIntakeAction();
      expect(result).toMatchObject({ ok: false });
    }
    expect(repository.listUnmatchedEvidenceWithCandidates).not.toHaveBeenCalled();
  });

  it("lets CEO read but reports that they cannot decide", async () => {
    session.role = "CEO";
    await expect(loadFinanceEvidenceIntakeAction()).resolves.toEqual({ ok: true, canDecide: false, items: [] });
  });

  it("scopes the read to the caller's agency and role", async () => {
    await loadFinanceEvidenceIntakeAction();
    expect(repository.listUnmatchedEvidenceWithCandidates).toHaveBeenCalledWith({ agencyId: AGENCY, viewerRole: "FINANCE" });
  });

  it("refuses a caller whose agency cannot be identified", async () => {
    session.agencyId = null;
    await expect(loadFinanceEvidenceIntakeAction()).resolves.toMatchObject({ ok: false });
  });
});

describe("matchFinanceEvidenceAction", () => {
  it("rejects unknown fields and malformed ids before any write", async () => {
    await expect(matchFinanceEvidenceAction({ evidenceId: "nope", paymentId: PAYMENT })).resolves.toMatchObject({ ok: false });
    await expect(matchFinanceEvidenceAction({ evidenceId: EVIDENCE, paymentId: PAYMENT, agencyId: "other" })).resolves.toMatchObject({ ok: false });
    expect(repository.matchEvidenceToPayment).not.toHaveBeenCalled();
  });

  it("refuses CEO and read-only roles without calling the repository", async () => {
    for (const role of ["CEO", "OPERATIONS"]) {
      session.role = role;
      await expect(matchFinanceEvidenceAction({ evidenceId: EVIDENCE, paymentId: PAYMENT })).resolves.toMatchObject({ ok: false });
    }
    expect(repository.matchEvidenceToPayment).not.toHaveBeenCalled();
  });

  it("matches with the caller's own agency and actor, ignoring anything the client claims", async () => {
    const result = await matchFinanceEvidenceAction({ evidenceId: EVIDENCE, paymentId: PAYMENT });
    expect(result).toMatchObject({ ok: true });
    expect(repository.matchEvidenceToPayment).toHaveBeenCalledWith({
      agencyId: AGENCY,
      evidenceId: EVIDENCE,
      paymentId: PAYMENT,
      actor: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Amina", role: "FINANCE" },
    });
  });

  it("returns the repository's plain-language refusal", async () => {
    repository.matchEvidenceToPayment.mockResolvedValue({ ok: false, code: "ALREADY_REVIEWED", error: "This receipt has already been reviewed." });
    await expect(matchFinanceEvidenceAction({ evidenceId: EVIDENCE, paymentId: PAYMENT })).resolves.toEqual({
      ok: false,
      error: "This receipt has already been reviewed.",
    });
  });

  it("replaces an unexpected failure with plain words", async () => {
    repository.matchEvidenceToPayment.mockRejectedValue(new Error('relation "finance_evidence_intake" violates constraint'));
    const result = await matchFinanceEvidenceAction({ evidenceId: EVIDENCE, paymentId: PAYMENT });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("finance_evidence_intake");
  });
});

describe("dismissFinanceEvidenceAction", () => {
  it("requires a reason", async () => {
    await expect(dismissFinanceEvidenceAction({ evidenceId: EVIDENCE, reason: "   " })).resolves.toMatchObject({ ok: false });
    expect(repository.dismissFinanceEvidence).not.toHaveBeenCalled();
  });

  it("dismisses as an authorised role with the trimmed reason", async () => {
    session.role = "ADMIN";
    await expect(dismissFinanceEvidenceAction({ evidenceId: EVIDENCE, reason: "  Duplicate receipt " })).resolves.toMatchObject({ ok: true });
    expect(repository.dismissFinanceEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ agencyId: AGENCY, evidenceId: EVIDENCE, reason: "Duplicate receipt" }),
    );
  });

  it("refuses CEO", async () => {
    session.role = "CEO";
    await expect(dismissFinanceEvidenceAction({ evidenceId: EVIDENCE, reason: "Duplicate" })).resolves.toMatchObject({ ok: false });
    expect(repository.dismissFinanceEvidence).not.toHaveBeenCalled();
  });
});
