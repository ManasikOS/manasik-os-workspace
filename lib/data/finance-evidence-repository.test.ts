import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createFinanceEvidenceRepository,
  type AgencyScopedEvidencePayment,
  type FinanceEvidenceSource,
  type PendingFinanceEvidence,
  type ReviewableFinanceEvidence,
} from "./finance-evidence-repository";

const AGENCY = "10000000-0000-4000-8000-000000000001";
const ATTACHMENT = "20000000-0000-4000-8000-000000000002";
const EVIDENCE = "30000000-0000-4000-8000-000000000003";

function source(overrides: Partial<FinanceEvidenceSource> = {}): FinanceEvidenceSource {
  return {
    agencyId: AGENCY,
    conversationId: "40000000-0000-4000-8000-000000000004",
    messageId: "50000000-0000-4000-8000-000000000005",
    attachmentId: ATTACHMENT,
    analysisId: "60000000-0000-4000-8000-000000000006",
    assignedToId: null,
    leadId: null,
    bookingId: null,
    departureGroupId: null,
    customerId: null,
    sourceStoragePath: `${AGENCY}/${ATTACHMENT}/receipt.jpg`,
    mimeType: "image/jpeg",
    byteSize: 1024,
    checksumSha256: "a".repeat(64),
    candidateFields: { amount: 50000 },
    confidence: 0.8,
    retentionDays: 90,
    ...overrides,
  };
}

function inMemoryFinanceEvidenceRepository() {
  const evidence = new Map<string, Record<string, unknown>>();
  const audits = new Map<string, Record<string, unknown>>();
  const payments: Record<string, unknown>[] = [];
  let copies = 0;

  const repository = createFinanceEvidenceRepository({
    async loadSource(agencyId, attachmentId) {
      return agencyId === AGENCY && attachmentId === ATTACHMENT ? source() : null;
    },
    async findEvidence(agencyId, attachmentId) {
      return (evidence.get(`${agencyId}:${attachmentId}`) as never) ?? null;
    },
    async copyObject() {
      copies += 1;
    },
    async insertEvidence(row) {
      const key = `${row.agency_id}:${row.source_attachment_id}`;
      const existing = evidence.get(key);
      if (existing) return { row: existing as never, inserted: false };
      await Promise.resolve();
      const concurrent = evidence.get(key);
      if (concurrent) return { row: concurrent as never, inserted: false };
      const stored = { ...row, id: EVIDENCE, status: "PENDING_REVIEW", payment_id: null };
      evidence.set(key, stored);
      return { row: stored as never, inserted: true };
    },
    async ensureAudit(row) {
      audits.set(row.id, row as unknown as Record<string, unknown>);
    },
    async listPendingEvidence() {
      return [];
    },
    async listPaymentCandidates() {
      return [];
    },    async loadEvidenceForReview() { return null; },
    async loadPaymentForReview() { return null; },
    async recordReview() { return { applied: false }; },
    async ensureReviewAudit() {},

    async findLinkedPaymentIds() {
      return new Set<string>();
    },
  });

  return { repository, evidence, audits, payments, copyCount: () => copies };
}

describe("FIN-02 finance evidence repository", () => {
  it("contains no payment-ledger mutation path", () => {
    const implementation = readFileSync(join(process.cwd(), "lib/data/finance-evidence-repository.ts"), "utf8");
    expect(implementation).not.toMatch(/recordPayment|verifyPayment|payment_allocations|bank_statement/i);
    // FIN-04 reads payments to rank candidates; the ledger must never be written.
    expect(implementation).not.toMatch(/from\(["']payments["']\)\s*\.(insert|update|upsert|delete)\b/);
    expect(implementation).not.toMatch(/from\(["']payments["']\)[\s\S]{0,400}?\.(insert|update|upsert|delete)\(/);
  });

  it("returns one evidence item and one audit trail under concurrent retries", async () => {
    const world = inMemoryFinanceEvidenceRepository();
    const request = {
      agencyId: AGENCY,
      attachmentId: ATTACHMENT,
      actor: { id: "70000000-0000-4000-8000-000000000007", name: "Amina", role: "FINANCE" },
      now: new Date("2026-09-30T00:00:00.000Z"),
    } as const;

    const [first, second] = await Promise.all([
      world.repository.copyReceiptEvidence(request),
      world.repository.copyReceiptEvidence(request),
    ]);

    expect(first.id).toBe(EVIDENCE);
    expect(second.id).toBe(EVIDENCE);
    expect(world.evidence.size).toBe(1);
    expect(world.audits.size).toBe(1);
  });

  it("returns the existing item on retry and does not copy the object again", async () => {
    const world = inMemoryFinanceEvidenceRepository();
    const request = { agencyId: AGENCY, attachmentId: ATTACHMENT, actor: { id: null, name: "Staff", role: "ADMIN" }, now: new Date("2026-09-30T00:00:00.000Z") } as const;
    await world.repository.copyReceiptEvidence(request);
    await world.repository.copyReceiptEvidence(request);
    expect(world.copyCount()).toBe(1);
  });

  it("cannot load a source attachment through another agency", async () => {
    const world = inMemoryFinanceEvidenceRepository();
    await expect(world.repository.copyReceiptEvidence({
      agencyId: "90000000-0000-4000-8000-000000000009",
      attachmentId: ATTACHMENT,
      actor: { id: null, name: "Staff", role: "ADMIN" },
      now: new Date("2026-09-30T00:00:00.000Z"),
    })).rejects.toThrow("Receipt attachment not found");
    expect(world.evidence.size).toBe(0);
  });

  it("rejects a cross-agency Storage path even if privileged source data is corrupt", async () => {
    const world = inMemoryFinanceEvidenceRepository();
    await expect(world.repository.copyReceiptEvidence({
      agencyId: AGENCY,
      attachmentId: ATTACHMENT,
      actor: { id: null, name: "Staff", role: "ADMIN" },
      now: new Date("2026-09-30T00:00:00.000Z"),
      source: source({ sourceStoragePath: "other-agency/private-receipt.jpg" }),
    })).rejects.toThrow("outside the caller's agency");
    expect(world.copyCount()).toBe(0);
  });

  it("rejects an oversized receipt before downloading it into server memory", async () => {
    const world = inMemoryFinanceEvidenceRepository();
    await expect(world.repository.copyReceiptEvidence({
      agencyId: AGENCY,
      attachmentId: ATTACHMENT,
      actor: { id: null, name: "Staff", role: "ADMIN" },
      source: source({ byteSize: 10 * 1024 * 1024 + 1 }),
    })).rejects.toThrow("size limit");
    expect(world.copyCount()).toBe(0);
  });

  it("never creates, updates, verifies, or reconciles a payment", async () => {
    const world = inMemoryFinanceEvidenceRepository();
    await world.repository.copyReceiptEvidence({
      agencyId: AGENCY,
      attachmentId: ATTACHMENT,
      actor: { id: null, name: "Staff", role: "FINANCE" },
      now: new Date("2026-09-30T00:00:00.000Z"),
    });
    expect(world.payments).toEqual([]);
    expect([...world.evidence.values()][0]).toMatchObject({ payment_id: null, status: "PENDING_REVIEW" });
  });
});

const OTHER_AGENCY = "90000000-0000-4000-8000-000000000009";

function pendingEvidence(overrides: Partial<PendingFinanceEvidence> = {}): PendingFinanceEvidence {
  return {
    id: EVIDENCE,
    agencyId: AGENCY,
    amount: 45000,
    reference: "TRX-88231",
    date: "2026-09-10",
    bookingId: null,
    departureGroupId: null,
    sourceConversationId: "40000000-0000-4000-8000-000000000004",
    sourceMessageId: "50000000-0000-4000-8000-000000000005",
    createdAt: "2026-09-30T00:00:00.000Z",
    ...overrides,
  };
}

function matchingPayment(overrides: Partial<AgencyScopedEvidencePayment> = {}): AgencyScopedEvidencePayment {
  return {
    agencyId: AGENCY,
    paymentId: "payment-1",
    paymentReference: "PAY-0001",
    referenceNumber: null,
    amount: 45000,
    currency: "LKR",
    paidAt: "2026-09-10T08:00:00.000Z",
    status: "COMPLETED",
    bookingId: "booking-1",
    departureGroupId: "group-1",
    reversesPaymentId: null,
    ...overrides,
  };
}

function matchingRepository(world: {
  evidence: PendingFinanceEvidence[];
  payments: AgencyScopedEvidencePayment[];
  linked?: string[];
}) {
  const calls: { evidenceAgency: string[]; paymentAgency: string[]; limit: number[] } = { evidenceAgency: [], paymentAgency: [], limit: [] };
  const repository = createFinanceEvidenceRepository({
    async loadSource() { return null; },
    async findEvidence() { return null; },
    async copyObject() {},
    async insertEvidence() { throw new Error("read-only test"); },
    async ensureAudit() {},
    async listPendingEvidence(agencyId, limit) {
      calls.evidenceAgency.push(agencyId);
      calls.limit.push(limit);
      return world.evidence;
    },
    async listPaymentCandidates(agencyId) {
      calls.paymentAgency.push(agencyId);
      return world.payments;
    },    async loadEvidenceForReview() { return null; },
    async loadPaymentForReview() { return null; },
    async recordReview() { return { applied: false }; },
    async ensureReviewAudit() {},

    async findLinkedPaymentIds() {
      return new Set(world.linked ?? []);
    },
  });
  return { repository, calls };
}

describe("FIN-04 finance evidence matching queue", () => {
  it("lists pending evidence with ranked candidates and reason codes, applying none", async () => {
    const { repository } = matchingRepository({ evidence: [pendingEvidence()], payments: [matchingPayment()] });
    const [item] = await repository.listUnmatchedEvidenceWithCandidates({ agencyId: AGENCY, viewerRole: "FINANCE" });
    expect(item.evidence.id).toBe(EVIDENCE);
    expect(item.match.autoApplied).toBe(false);
    expect(item.match.candidates[0]).toMatchObject({ paymentId: "payment-1", reasonCodes: ["AMOUNT_EXACT", "DATE_SAME_DAY"] });
  });

  it("denies roles that cannot review Finance evidence before reading anything", async () => {
    const { repository, calls } = matchingRepository({ evidence: [pendingEvidence()], payments: [matchingPayment()] });
    await expect(repository.listUnmatchedEvidenceWithCandidates({ agencyId: AGENCY, viewerRole: "OPERATIONS" }))
      .rejects.toThrow("Finance review access is required");
    expect(calls.evidenceAgency).toEqual([]);
    expect(calls.paymentAgency).toEqual([]);
  });

  it("scopes every read to the caller's agency and drops rows from another agency", async () => {
    const { repository, calls } = matchingRepository({
      evidence: [pendingEvidence(), pendingEvidence({ id: "leaked-evidence", agencyId: OTHER_AGENCY })],
      payments: [matchingPayment({ paymentId: "mine" }), matchingPayment({ paymentId: "leaked-payment", agencyId: OTHER_AGENCY })],
    });
    const items = await repository.listUnmatchedEvidenceWithCandidates({ agencyId: AGENCY, viewerRole: "ADMIN" });
    expect(calls.evidenceAgency).toEqual([AGENCY]);
    expect(calls.paymentAgency).toEqual([AGENCY]);
    expect(items.map((item) => item.evidence.id)).toEqual([EVIDENCE]);
    expect(items[0].match.candidates.map((candidate) => candidate.paymentId)).toEqual(["mine"]);
  });

  it("keeps ambiguous evidence unmatched with every tied candidate visible", async () => {
    const { repository } = matchingRepository({
      evidence: [pendingEvidence({ reference: null })],
      payments: [matchingPayment({ paymentId: "a" }), matchingPayment({ paymentId: "b", paymentReference: "PAY-0002" })],
    });
    const [item] = await repository.listUnmatchedEvidenceWithCandidates({ agencyId: AGENCY, viewerRole: "CEO" });
    expect(item.match.outcome).toBe("AMBIGUOUS");
    expect(item.match.candidates).toHaveLength(2);
  });

  it("excludes payments already linked to other evidence", async () => {
    const { repository } = matchingRepository({
      evidence: [pendingEvidence()],
      payments: [matchingPayment({ paymentId: "taken" }), matchingPayment({ paymentId: "free", paymentReference: "PAY-0002" })],
      linked: ["taken"],
    });
    const [item] = await repository.listUnmatchedEvidenceWithCandidates({ agencyId: AGENCY, viewerRole: "FINANCE" });
    expect(item.match.candidates.map((candidate) => candidate.paymentId)).toEqual(["free"]);
  });

  it("returns an empty queue without querying payments when no evidence is pending", async () => {
    const { repository, calls } = matchingRepository({ evidence: [], payments: [matchingPayment()] });
    await expect(repository.listUnmatchedEvidenceWithCandidates({ agencyId: AGENCY, viewerRole: "FINANCE" })).resolves.toEqual([]);
    expect(calls.paymentAgency).toEqual([]);
  });

  it("clamps the page size so a caller cannot request an unbounded queue", async () => {
    const { repository, calls } = matchingRepository({ evidence: [], payments: [] });
    await repository.listUnmatchedEvidenceWithCandidates({ agencyId: AGENCY, viewerRole: "FINANCE", limit: 100_000 });
    await repository.listUnmatchedEvidenceWithCandidates({ agencyId: AGENCY, viewerRole: "FINANCE", limit: 0 });
    await repository.listUnmatchedEvidenceWithCandidates({ agencyId: AGENCY, viewerRole: "FINANCE" });
    expect(calls.limit).toEqual([100, 1, 50]);
  });
});

const FINANCE_ACTOR = { id: "70000000-0000-4000-8000-000000000007", name: "Amina", role: "FINANCE" } as const;

function reviewWorld(overrides: {
  evidence?: ReviewableFinanceEvidence | null;
  payment?: AgencyScopedEvidencePayment | null;
  linked?: string[];
  raceLoses?: boolean;
} = {}) {
  let evidence: ReviewableFinanceEvidence | null = overrides.evidence === undefined ? reviewable() : overrides.evidence;
  const audits = new Map<string, Record<string, unknown>>();
  const reviews: unknown[] = [];
  const repository = createFinanceEvidenceRepository({
    async loadSource() { return null; },
    async findEvidence() { return null; },
    async copyObject() {},
    async insertEvidence() { throw new Error("not used"); },
    async ensureAudit() {},
    async listPendingEvidence() { return []; },
    async listPaymentCandidates() { return []; },
    async loadEvidenceForReview(agencyId, evidenceId) {
      return evidence && evidence.agencyId === agencyId && evidence.id === evidenceId ? evidence : null;
    },
    async loadPaymentForReview(agencyId, paymentId) {
      const payment = overrides.payment === undefined ? matchingPayment() : overrides.payment;
      return payment && payment.agencyId === agencyId && payment.paymentId === paymentId ? payment : null;
    },
    async findLinkedPaymentIds() { return new Set(overrides.linked ?? []); },
    async recordReview(row) {
      reviews.push(row);
      if (overrides.raceLoses) {
        evidence = evidence && { ...evidence, status: "DISMISSED", paymentId: null };
        return { applied: false };
      }
      if (!evidence || evidence.status !== "PENDING_REVIEW") return { applied: false };
      evidence = { ...evidence, status: row.status, paymentId: row.paymentId };
      return { applied: true };
    },
    async ensureReviewAudit(row) { audits.set(row.id, row as unknown as Record<string, unknown>); },
  });
  return { repository, audits, reviews, current: () => evidence };
}

function reviewable(overrides: Partial<ReviewableFinanceEvidence> = {}): ReviewableFinanceEvidence {
  return { ...pendingEvidence(), status: "PENDING_REVIEW", paymentId: null, ...overrides };
}

describe("FIN-05 finance evidence review commands", () => {
  it("matches evidence to a deterministic candidate and records one audit event without touching the payment", async () => {
    const world = reviewWorld();
    const result = await world.repository.matchEvidenceToPayment({ agencyId: AGENCY, evidenceId: EVIDENCE, paymentId: "payment-1", actor: FINANCE_ACTOR });
    expect(result).toEqual({ ok: true, status: "MATCHED_TO_PAYMENT", paymentId: "payment-1" });
    expect(world.current()).toMatchObject({ status: "MATCHED_TO_PAYMENT", paymentId: "payment-1" });
    expect(world.audits.size).toBe(1);
    expect([...world.audits.values()][0]).toMatchObject({ agency_id: AGENCY, action: "NOTE_ADDED", payment_id: "payment-1", booking_id: "booking-1" });
    expect(String([...world.audits.values()][0].note)).toContain("No payment was verified");
  });

  it("refuses roles that cannot decide evidence, including CEO", async () => {
    for (const role of ["CEO", "OPERATIONS", "MARKETING"]) {
      const world = reviewWorld();
      const result = await world.repository.matchEvidenceToPayment({ agencyId: AGENCY, evidenceId: EVIDENCE, paymentId: "payment-1", actor: { ...FINANCE_ACTOR, role } });
      expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(world.reviews).toEqual([]);
    }
  });

  it("will not match a payment the matcher does not rank as a candidate", async () => {
    const world = reviewWorld({ payment: matchingPayment({ amount: 1, paymentReference: "OTHER-9" }) });
    const result = await world.repository.matchEvidenceToPayment({ agencyId: AGENCY, evidenceId: EVIDENCE, paymentId: "payment-1", actor: FINANCE_ACTOR });
    expect(result).toMatchObject({ ok: false, code: "NOT_A_CANDIDATE" });
    expect(world.reviews).toEqual([]);
  });

  it("will not match a payment another evidence item already claimed", async () => {
    const world = reviewWorld({ linked: ["payment-1"] });
    const result = await world.repository.matchEvidenceToPayment({ agencyId: AGENCY, evidenceId: EVIDENCE, paymentId: "payment-1", actor: FINANCE_ACTOR });
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_ALREADY_LINKED" });
  });

  it("cannot see evidence or payments from another agency", async () => {
    const world = reviewWorld();
    const result = await world.repository.matchEvidenceToPayment({ agencyId: OTHER_AGENCY, evidenceId: EVIDENCE, paymentId: "payment-1", actor: FINANCE_ACTOR });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(world.reviews).toEqual([]);
  });

  it("is idempotent for a repeated identical match and rejects a conflicting second decision", async () => {
    const world = reviewWorld();
    const request = { agencyId: AGENCY, evidenceId: EVIDENCE, paymentId: "payment-1", actor: FINANCE_ACTOR };
    await world.repository.matchEvidenceToPayment(request);
    const repeat = await world.repository.matchEvidenceToPayment(request);
    expect(repeat).toEqual({ ok: true, status: "MATCHED_TO_PAYMENT", paymentId: "payment-1" });
    expect(world.audits.size).toBe(1);
    const conflicting = await world.repository.dismissFinanceEvidence({ agencyId: AGENCY, evidenceId: EVIDENCE, reason: "Not ours", actor: FINANCE_ACTOR });
    expect(conflicting).toMatchObject({ ok: false, code: "ALREADY_REVIEWED" });
  });

  it("reports ALREADY_REVIEWED when a concurrent reviewer wins the race", async () => {
    const world = reviewWorld({ raceLoses: true });
    const result = await world.repository.matchEvidenceToPayment({ agencyId: AGENCY, evidenceId: EVIDENCE, paymentId: "payment-1", actor: FINANCE_ACTOR });
    expect(result).toMatchObject({ ok: false, code: "ALREADY_REVIEWED" });
    expect(world.audits.size).toBe(0);
  });

  it("dismisses evidence with a required reason and no payment link", async () => {
    const world = reviewWorld();
    const blank = await world.repository.dismissFinanceEvidence({ agencyId: AGENCY, evidenceId: EVIDENCE, reason: "   ", actor: FINANCE_ACTOR });
    expect(blank).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    const dismissed = await world.repository.dismissFinanceEvidence({ agencyId: AGENCY, evidenceId: EVIDENCE, reason: "Duplicate of an earlier receipt", actor: FINANCE_ACTOR });
    expect(dismissed).toEqual({ ok: true, status: "DISMISSED", paymentId: null });
    expect(world.current()).toMatchObject({ status: "DISMISSED", paymentId: null });
    expect(String([...world.audits.values()][0].note)).toContain("Duplicate of an earlier receipt");
  });
});
