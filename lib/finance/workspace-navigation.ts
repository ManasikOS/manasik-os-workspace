import type { FinanceCapabilities } from "@/lib/access/finance-access";

export const FINANCE_WORKSPACE_VIEWS = [
  "overview",
  "receivables",
  "payables",
  "reconciliation",
  "departure-pnl",
  "departure-safety",
] as const;

export const FINANCE_RECEIVABLES_SUBVIEWS = [
  "balances",
  "payments",
  "payment-plans",
  "invoices",
  "adjustments",
] as const;

export type FinanceWorkspaceView = (typeof FINANCE_WORKSPACE_VIEWS)[number];
export type FinanceReceivablesSubview = (typeof FINANCE_RECEIVABLES_SUBVIEWS)[number];

export type FinanceWorkspaceNavigation =
  | { view: "receivables"; subview: FinanceReceivablesSubview; evidenceId?: string }
  | { view: Exclude<FinanceWorkspaceView, "receivables">; subview?: never };

export type FinanceWorkspaceQuery = {
  view?: string | string[];
  subview?: string | string[];
  evidenceId?: string | string[];
};

type LegacyFinanceTabQuery = {
  tab?: string | string[];
};

const EVIDENCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasSingleQueryValue(value: string | string[] | undefined): value is string {
  return typeof value === "string";
}

function isWorkspaceView(value: string | undefined): value is FinanceWorkspaceView {
  return FINANCE_WORKSPACE_VIEWS.some((view) => view === value);
}

function isReceivablesSubview(value: string | undefined): value is FinanceReceivablesSubview {
  return FINANCE_RECEIVABLES_SUBVIEWS.some((subview) => subview === value);
}

export function financeWorkspaceViewIsVisible(
  view: FinanceWorkspaceView,
  can: FinanceCapabilities,
): boolean {
  switch (view) {
    case "overview":
      return can.viewModule && !can.viewPaymentStatusOnly;
    case "receivables":
      return can.viewReceivables;
    case "payables":
    case "departure-pnl":
    case "departure-safety":
      return can.viewSupplierPayables;
    case "reconciliation":
      return can.viewReconciliation;
  }
}

export function financeReceivablesSubviewIsVisible(
  subview: FinanceReceivablesSubview,
  can: FinanceCapabilities,
): boolean {
  switch (subview) {
    case "balances":
    case "payment-plans":
      return can.viewReceivables;
    case "payments":
      return can.viewLedger;
    case "invoices":
      return can.viewInvoices;
    case "adjustments":
      return can.viewRefunds;
  }
}

function firstSafeFinanceWorkspaceNavigation(can: FinanceCapabilities): FinanceWorkspaceNavigation | undefined {
  if (financeWorkspaceViewIsVisible("overview", can)) return { view: "overview" };

  if (financeWorkspaceViewIsVisible("receivables", can)) {
    const firstVisibleSubview = FINANCE_RECEIVABLES_SUBVIEWS.find((subview) =>
      financeReceivablesSubviewIsVisible(subview, can),
    );
    if (firstVisibleSubview) return { view: "receivables", subview: firstVisibleSubview };
  }

  if (financeWorkspaceViewIsVisible("payables", can)) return { view: "payables" };
  if (financeWorkspaceViewIsVisible("reconciliation", can)) return { view: "reconciliation" };
  if (financeWorkspaceViewIsVisible("departure-pnl", can)) return { view: "departure-pnl" };

  return undefined;
}

export function resolveFinanceWorkspaceNavigation(
  query: FinanceWorkspaceQuery,
  can: FinanceCapabilities,
): FinanceWorkspaceNavigation | undefined {
  const defaultNavigation = firstSafeFinanceWorkspaceNavigation(can);
  if (!defaultNavigation) return undefined;

  if (!hasSingleQueryValue(query.view) || !isWorkspaceView(query.view) || !financeWorkspaceViewIsVisible(query.view, can)) {
    return defaultNavigation;
  }

  if (query.view !== "receivables") return { view: query.view };

  if (query.subview === undefined) return { view: "receivables", subview: "balances" };

  if (
    hasSingleQueryValue(query.subview) &&
    isReceivablesSubview(query.subview) &&
    financeReceivablesSubviewIsVisible(query.subview, can)
  ) {
    if (query.subview === "payments" && hasSingleQueryValue(query.evidenceId) && EVIDENCE_ID_PATTERN.test(query.evidenceId)) {
      return { view: "receivables", subview: "payments", evidenceId: query.evidenceId.toLowerCase() };
    }
    return { view: "receivables", subview: query.subview };
  }

  return defaultNavigation;
}

const LEGACY_FINANCE_TAB_NAVIGATION: Record<string, FinanceWorkspaceNavigation> = {
  overview: { view: "overview" },
  receivables: { view: "receivables", subview: "balances" },
  payments: { view: "receivables", subview: "payments" },
  invoices: { view: "receivables", subview: "invoices" },
  "supplier-payables": { view: "payables" },
  refunds: { view: "receivables", subview: "adjustments" },
  reconciliation: { view: "reconciliation" },
};

/** Resolves retired `/finance/payments?tab=` links without trusting the query. */
export function resolveLegacyFinanceTabNavigation(
  query: LegacyFinanceTabQuery,
  can: FinanceCapabilities,
): FinanceWorkspaceNavigation | undefined {
  const defaultNavigation: FinanceWorkspaceNavigation = { view: "receivables", subview: "balances" };
  if (!hasSingleQueryValue(query.tab)) return resolveFinanceWorkspaceNavigation(defaultNavigation, can);

  const navigation = LEGACY_FINANCE_TAB_NAVIGATION[query.tab];
  if (!navigation) return resolveFinanceWorkspaceNavigation(defaultNavigation, can);

  return resolveFinanceWorkspaceNavigation(navigation, can);
}

export function financeWorkspaceHref(navigation: FinanceWorkspaceNavigation): string {
  const params = new URLSearchParams({ view: navigation.view });
  if (navigation.subview) params.set("subview", navigation.subview);
  if (navigation.subview === "payments" && navigation.evidenceId) params.set("evidenceId", navigation.evidenceId);
  return `/finance?${params.toString()}`;
}
