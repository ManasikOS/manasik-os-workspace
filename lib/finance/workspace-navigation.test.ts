import { describe, expect, it } from "vitest";

import {
  financeWorkspaceHref,
  resolveFinanceWorkspaceNavigation,
  resolveLegacyFinanceTabNavigation,
} from "./workspace-navigation";
import { capabilitiesForFinance } from "@/lib/access/finance-access";

describe("resolveFinanceWorkspaceNavigation", () => {
  it("keeps an authorised Finance user on their requested receivables subview", () => {
    expect(
      resolveFinanceWorkspaceNavigation(
        { view: "receivables", subview: "payment-plans" },
        capabilitiesForFinance("FINANCE"),
      ),
    ).toMatchObject({ view: "receivables", subview: "payment-plans" });
  });

  it("falls back to payment readiness when a limited role requests a protected view", () => {
    expect(
      resolveFinanceWorkspaceNavigation(
        { view: "reconciliation" },
        capabilitiesForFinance("OPERATIONS"),
      ),
    ).toMatchObject({ view: "receivables", subview: "balances" });
  });

  it("uses the first authorised view for an invalid URL", () => {
    expect(
      resolveFinanceWorkspaceNavigation(
        { view: "not-a-finance-view", subview: "unknown" },
        capabilitiesForFinance("CEO"),
      ),
    ).toMatchObject({ view: "overview" });
  });

  it("rejects repeated query values instead of accepting only their first value", () => {
    expect(
      resolveFinanceWorkspaceNavigation(
        { view: ["receivables", "reconciliation"], subview: "payments" },
        capabilitiesForFinance("FINANCE"),
      ),
    ).toEqual({ view: "overview" });

    expect(
      resolveFinanceWorkspaceNavigation(
        { view: "receivables", subview: ["balances", "payments"] },
        capabilitiesForFinance("FINANCE"),
      ),
    ).toEqual({ view: "overview" });
  });

  it("returns the first safe view when a receivables subview is malformed or inaccessible", () => {
    expect(
      resolveFinanceWorkspaceNavigation(
        { view: "receivables", subview: "not-a-receivables-subview" },
        capabilitiesForFinance("FINANCE"),
      ),
    ).toEqual({ view: "overview" });

    expect(
      resolveFinanceWorkspaceNavigation(
        { view: "receivables", subview: "payments" },
        capabilitiesForFinance("OPERATIONS"),
      ),
    ).toEqual({ view: "receivables", subview: "balances" });
  });

  it("uses only role-safe destinations for Finance, CEO, Operations, and Marketing", () => {
    expect(
      resolveFinanceWorkspaceNavigation({ view: "departure-pnl" }, capabilitiesForFinance("FINANCE")),
    ).toEqual({ view: "departure-pnl" });
    expect(
      resolveFinanceWorkspaceNavigation({ view: "reconciliation" }, capabilitiesForFinance("CEO")),
    ).toEqual({ view: "reconciliation" });
    expect(
      resolveFinanceWorkspaceNavigation({ view: "departure-safety" }, capabilitiesForFinance("CEO")),
    ).toEqual({ view: "departure-safety" });
    expect(
      resolveFinanceWorkspaceNavigation({ view: "payables" }, capabilitiesForFinance("OPERATIONS")),
    ).toEqual({ view: "receivables", subview: "balances" });
    expect(
      resolveFinanceWorkspaceNavigation({ view: "overview" }, capabilitiesForFinance("MARKETING")),
    ).toEqual({ view: "receivables", subview: "balances" });
    expect(
      resolveFinanceWorkspaceNavigation({ view: "departure-safety" }, capabilitiesForFinance("OPERATIONS")),
    ).toEqual({ view: "receivables", subview: "balances" });
  });

  it("returns no navigation when the caller has no Finance access", () => {
    expect(
      resolveFinanceWorkspaceNavigation({ view: "overview" }, capabilitiesForFinance("VISA")),
    ).toBeUndefined();
  });

  it("maps each legacy Finance tab to its canonical authorised destination", () => {
    const can = capabilitiesForFinance("FINANCE");

    expect(resolveLegacyFinanceTabNavigation({}, can)).toEqual({ view: "receivables", subview: "balances" });
    expect(resolveLegacyFinanceTabNavigation({ tab: "overview" }, can)).toEqual({ view: "overview" });
    expect(resolveLegacyFinanceTabNavigation({ tab: "receivables" }, can)).toEqual({
      view: "receivables",
      subview: "balances",
    });
    expect(resolveLegacyFinanceTabNavigation({ tab: "payments" }, can)).toEqual({
      view: "receivables",
      subview: "payments",
    });
    expect(resolveLegacyFinanceTabNavigation({ tab: "invoices" }, can)).toEqual({
      view: "receivables",
      subview: "invoices",
    });
    expect(resolveLegacyFinanceTabNavigation({ tab: "supplier-payables" }, can)).toEqual({ view: "payables" });
    expect(resolveLegacyFinanceTabNavigation({ tab: "refunds" }, can)).toEqual({
      view: "receivables",
      subview: "adjustments",
    });
    expect(resolveLegacyFinanceTabNavigation({ tab: "reconciliation" }, can)).toEqual({ view: "reconciliation" });
  });

  it("falls back safely for inaccessible, malformed, and unknown legacy Finance tabs", () => {
    const operations = capabilitiesForFinance("OPERATIONS");

    expect(resolveLegacyFinanceTabNavigation({ tab: "supplier-payables" }, operations)).toEqual({
      view: "receivables",
      subview: "balances",
    });
    expect(resolveLegacyFinanceTabNavigation({ tab: ["payments", "refunds"] }, operations)).toEqual({
      view: "receivables",
      subview: "balances",
    });
    expect(resolveLegacyFinanceTabNavigation({ tab: "not-a-finance-tab" }, operations)).toEqual({
      view: "receivables",
      subview: "balances",
    });
  });

  it("generates every canonical Finance workspace href", () => {
    expect(financeWorkspaceHref({ view: "overview" })).toBe("/finance?view=overview");
    expect(financeWorkspaceHref({ view: "receivables", subview: "balances" })).toBe(
      "/finance?view=receivables&subview=balances",
    );
    expect(financeWorkspaceHref({ view: "receivables", subview: "payments" })).toBe(
      "/finance?view=receivables&subview=payments",
    );
    expect(financeWorkspaceHref({ view: "receivables", subview: "payment-plans" })).toBe(
      "/finance?view=receivables&subview=payment-plans",
    );
    expect(financeWorkspaceHref({ view: "receivables", subview: "invoices" })).toBe(
      "/finance?view=receivables&subview=invoices",
    );
    expect(financeWorkspaceHref({ view: "receivables", subview: "adjustments" })).toBe(
      "/finance?view=receivables&subview=adjustments",
    );
    expect(financeWorkspaceHref({ view: "payables" })).toBe("/finance?view=payables");
    expect(financeWorkspaceHref({ view: "reconciliation" })).toBe("/finance?view=reconciliation");
    expect(financeWorkspaceHref({ view: "departure-pnl" })).toBe("/finance?view=departure-pnl");
    expect(financeWorkspaceHref({ view: "departure-safety" })).toBe("/finance?view=departure-safety");
  });
});

describe("Finance evidence deep links", () => {
  const EVIDENCE_ID = "30000000-0000-4000-8000-000000000003";
  const finance = capabilitiesForFinance("FINANCE");

  it("keeps a well-formed evidence id on the payments subview", () => {
    expect(
      resolveFinanceWorkspaceNavigation({ view: "receivables", subview: "payments", evidenceId: EVIDENCE_ID }, finance),
    ).toEqual({ view: "receivables", subview: "payments", evidenceId: EVIDENCE_ID });
  });

  it("drops a malformed or repeated evidence id instead of trusting the address", () => {
    expect(
      resolveFinanceWorkspaceNavigation({ view: "receivables", subview: "payments", evidenceId: "not-a-uuid" }, finance),
    ).toEqual({ view: "receivables", subview: "payments" });
    expect(
      resolveFinanceWorkspaceNavigation({ view: "receivables", subview: "payments", evidenceId: [EVIDENCE_ID, EVIDENCE_ID] }, finance),
    ).toEqual({ view: "receivables", subview: "payments" });
  });

  it("ignores an evidence id on any other view or subview", () => {
    expect(
      resolveFinanceWorkspaceNavigation({ view: "receivables", subview: "invoices", evidenceId: EVIDENCE_ID }, finance),
    ).toEqual({ view: "receivables", subview: "invoices" });
    expect(resolveFinanceWorkspaceNavigation({ view: "payables", evidenceId: EVIDENCE_ID }, finance)).toEqual({ view: "payables" });
  });

  it("does not reveal the evidence id to a role that cannot open the payments ledger", () => {
    const result = resolveFinanceWorkspaceNavigation(
      { view: "receivables", subview: "payments", evidenceId: EVIDENCE_ID },
      capabilitiesForFinance("OPERATIONS"),
    );
    expect(result).toEqual({ view: "receivables", subview: "balances" });
  });

  it("round-trips an evidence id through the canonical href", () => {
    expect(financeWorkspaceHref({ view: "receivables", subview: "payments", evidenceId: EVIDENCE_ID })).toBe(
      `/finance?view=receivables&subview=payments&evidenceId=${EVIDENCE_ID}`,
    );
  });
});
