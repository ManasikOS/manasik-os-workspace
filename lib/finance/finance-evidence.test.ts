import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canCopyReceiptToFinance,
  copyReceiptToFinanceSchema,
  financeEvidenceDestinationPath,
  financeEvidenceRetentionExpiry,
  receiptCandidateFromAnalysis,
} from "./finance-evidence";

const STAFF = "10000000-0000-4000-8000-000000000001";

describe("FIN-02 finance evidence rules", () => {
  it("accepts only one UUID from the browser", () => {
    expect(copyReceiptToFinanceSchema.safeParse({ attachmentId: STAFF }).success).toBe(true);
    expect(copyReceiptToFinanceSchema.safeParse({ attachmentId: STAFF, agencyId: STAFF }).success).toBe(false);
  });

  it.each(["ADMIN", "CEO", "FINANCE"] as const)("allows %s to copy receipt evidence", (role) => {
    expect(canCopyReceiptToFinance({ role, staffId: STAFF, assignedToId: null, openFinanceReview: true })).toBe(true);
  });

  it("allows only an assigned staff member when their effective capability opens Finance review", () => {
    expect(canCopyReceiptToFinance({ role: "OPERATIONS", staffId: STAFF, assignedToId: STAFF, openFinanceReview: true })).toBe(true);
    expect(canCopyReceiptToFinance({ role: "OPERATIONS", staffId: STAFF, assignedToId: STAFF, openFinanceReview: false })).toBe(false);
    expect(canCopyReceiptToFinance({ role: "OPERATIONS", staffId: STAFF, assignedToId: "other", openFinanceReview: true })).toBe(false);
  });

  it("creates an agency-prefixed deterministic destination without trusting the filename", () => {
    expect(financeEvidenceDestinationPath({
      agencyId: "20000000-0000-4000-8000-000000000002",
      attachmentId: "30000000-0000-4000-8000-000000000003",
      mimeType: "image/jpeg",
    })).toBe("20000000-0000-4000-8000-000000000002/inbox-receipts/30000000-0000-4000-8000-000000000003.jpg");
  });

  it("maps only supported receipt candidates and labels them as unverified model output", () => {
    expect(receiptCandidateFromAnalysis({ amount: 125000, reference: " TX-8 ", paidAt: "2026-09-29" }, 0.91)).toEqual({
      amount: 125000,
      reference: "TX-8",
      date: "2026-09-29",
      confidence: 0.91,
      attribution: {
        amount: "MODEL_CANDIDATE",
        reference: "MODEL_CANDIDATE",
        date: "MODEL_CANDIDATE",
        authoritative: false,
      },
    });
  });

  it("rejects malformed candidate values instead of treating them as payment truth", () => {
    expect(receiptCandidateFromAnalysis({ amount: -1, reference: "", paidAt: "tomorrow" }, 4)).toEqual({
      amount: null,
      reference: null,
      date: null,
      confidence: 1,
      attribution: { authoritative: false },
    });
  });

  it("derives unmatched evidence expiry from the agency Inbox policy", () => {
    expect(financeEvidenceRetentionExpiry("2026-09-30T00:00:00.000Z", 90)).toBe("2026-12-29T00:00:00.000Z");
  });

  it("keeps the Server Action auth-first and outside payment mutation APIs", () => {
    const actions = readFileSync(join(process.cwd(), "app/inbox/actions.ts"), "utf8");
    const start = actions.indexOf("export async function copyReceiptToFinanceAction");
    const end = actions.indexOf("const inboxTranslationRequestSchema", start);
    const implementation = actions.slice(start, end);
    expect(implementation.indexOf("await requireUser()")).toBeLessThan(implementation.indexOf("copyReceiptToFinanceSchema.safeParse"));
    expect(implementation).toContain("canCopyReceiptToFinance");
    expect(implementation).not.toMatch(/from\(["']payments["']\)|recordPayment|verifyPayment|reconcil/i);
  });
});
