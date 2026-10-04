"use client";

import PageHeader from "@/components/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, MoreVertical, Plus } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useCallback, useMemo, useState } from "react";

import type { FinanceTabId } from "@/lib/access/finance-access";
import {
  FINANCE_RECEIVABLES_SUBVIEWS,
  FINANCE_WORKSPACE_VIEWS,
  financeReceivablesSubviewIsVisible,
  financeWorkspaceViewIsVisible,
  financeWorkspaceHref,
  type FinanceReceivablesSubview,
  type FinanceWorkspaceNavigation,
  type FinanceWorkspaceView,
} from "@/lib/finance/workspace-navigation";

import { useFinance } from "../finance-store";
import OverviewTab from "./tabs/overview-tab";
import ReceivablesTab from "./tabs/receivables-tab";
import PaymentsTab from "./tabs/payments-tab";
import InvoicesTab from "./tabs/invoices-tab";
import SupplierPayablesTab from "./tabs/supplier-payables-tab";
import RefundsTab from "./tabs/refunds-tab";
import ReconciliationTab from "./tabs/reconciliation-tab";
import RecordPaymentDialog from "./record-payment-dialog";
import PaymentPlansView from "../../payment-plans/components/payment-plans-view";
import ProfitabilityView from "../../departure-profitability/components/profitability-view";
import DepartureFinancialSafetyView from "./departure-financial-safety-view";
import FinanceEvidenceIntake from "./finance-evidence-intake";
import { canReviewFinanceEvidence } from "@/lib/finance/evidence-matching";

const FINANCE_WORKSPACE_VIEW_LABELS: Record<FinanceWorkspaceView, string> = {
  overview: "Overview",
  receivables: "Receivables",
  payables: "Payables",
  reconciliation: "Reconciliation",
  "departure-pnl": "Departure P&L",
  "departure-safety": "Departure Safety",
};

const FINANCE_RECEIVABLES_SUBVIEW_LABELS: Record<FinanceReceivablesSubview, string> = {
  balances: "Balances",
  payments: "Payments",
  "payment-plans": "Payment Plans",
  invoices: "Invoices",
  adjustments: "Adjustments",
};

export default function FinanceWorkspace({
  initialNavigation,
}: {
  initialNavigation?: FinanceWorkspaceNavigation;
} = {}) {
  const { snapshot, can, role } = useFinance();
  const router = useRouter();

  const visibleViews = useMemo(
    () => FINANCE_WORKSPACE_VIEWS.filter((view) => financeWorkspaceViewIsVisible(view, can)),
    [can],
  );
  const visibleReceivablesSubviews = useMemo(
    () => FINANCE_RECEIVABLES_SUBVIEWS.filter((subview) => financeReceivablesSubviewIsVisible(subview, can)),
    [can],
  );
  const [navigation, setNavigation] = useState<FinanceWorkspaceNavigation>(
    initialNavigation ?? { view: "overview" },
  );
  const [headerPaymentOpen, setHeaderPaymentOpen] = useState(false);

  const navigateToFinanceWorkspace = useCallback(
    (nextNavigation: FinanceWorkspaceNavigation) => {
      setNavigation(nextNavigation);
      router.replace(financeWorkspaceHref(nextNavigation), { scroll: false });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [router],
  );

  const navigateFromFinanceOverview = useCallback(
    (legacyTab: FinanceTabId) => {
      navigateToFinanceWorkspace(financeTabToNavigation(legacyTab));
    },
    [navigateToFinanceWorkspace],
  );

  const renderFinanceWorkspaceView = () => {
    switch (navigation.view) {
      case "overview":
        return <OverviewTab onNavigate={navigateFromFinanceOverview} onOpenDepartureSafety={() => navigateToFinanceWorkspace({ view: "departure-safety" })} />;
      case "receivables":
        switch (navigation.subview) {
          case "balances":
            return <ReceivablesTab />;
          case "payments":
            return (
              <div className="flex flex-col gap-6">
                {can.viewLedger && canReviewFinanceEvidence(role) && (
                  <FinanceEvidenceIntake highlightEvidenceId={navigation.evidenceId} />
                )}
                <PaymentsTab />
              </div>
            );
          case "invoices":
            return <InvoicesTab />;
          case "adjustments":
            return <RefundsTab />;
          case "payment-plans":
            return <PaymentPlansView milestones={snapshot.paymentPlanMilestones} can={can} nowIso={snapshot.nowIso} />;
        }
      case "payables":
        return <SupplierPayablesTab />;
      case "reconciliation":
        return <ReconciliationTab />;
      case "departure-pnl":
        return <ProfitabilityView groups={snapshot.departureProfitability} nowIso={snapshot.nowIso} />;
      case "departure-safety":
        return can.viewSupplierPayables ? <DepartureFinancialSafetyView results={snapshot.departureFinancialSafety} /> : null;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Finance", link: "/finance" },
          { title: "Payments & Invoices", link: "/finance?view=receivables&subview=balances" },
        ]}
        title="Payments & Invoices"
        subTitle="Track customer collections, invoices, refunds, and supplier payables."
        action={
          <div className="flex items-center gap-2">
            {can.recordPayments && (
              <Button variant="secondary" onClick={() => setHeaderPaymentOpen(true)}>
                <Plus /> Record Payment
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline_without_border"><MoreVertical /></Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>More</DropdownMenuLabel>
                {can.exportFinanceReport && (
                  <DropdownMenuItem disabled>
                    <Download /> Export Finance Report
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="flex flex-col gap-5">
        <Tabs
          value={navigation.view}
          onValueChange={(value) => {
            const nextView = visibleViews.find((view) => view === value);
            if (!nextView) return;
            navigateToFinanceWorkspace(
              nextView === "receivables"
                ? { view: "receivables", subview: "balances" }
                : { view: nextView },
            );
          }}
        >
          <TabsList className="flex-wrap h-auto">
            {visibleViews.map((view) => (
              <TabsTrigger key={view} value={view}>
                {FINANCE_WORKSPACE_VIEW_LABELS[view]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {navigation.view === "receivables" && (
          <Tabs
            value={navigation.subview}
            onValueChange={(value) => {
              const nextSubview = visibleReceivablesSubviews.find((subview) => subview === value);
              if (nextSubview) navigateToFinanceWorkspace({ view: "receivables", subview: nextSubview });
            }}
          >
            <TabsList className="flex-wrap h-auto">
              {visibleReceivablesSubviews.map((subview) => (
                <TabsTrigger key={subview} value={subview}>
                  {FINANCE_RECEIVABLES_SUBVIEW_LABELS[subview]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        <div className="min-h-100">{renderFinanceWorkspaceView()}</div>
      </div>

      {can.recordPayments && (
        <RecordPaymentDialog
          booking={null}
          headerLaunch={headerPaymentOpen}
          onClose={() => setHeaderPaymentOpen(false)}
        />
      )}
    </div>
  );
}

function financeTabToNavigation(tab: FinanceTabId): FinanceWorkspaceNavigation {
  switch (tab) {
    case "overview": return { view: "overview" };
    case "payments": return { view: "receivables", subview: "payments" };
    case "invoices": return { view: "receivables", subview: "invoices" };
    case "refunds": return { view: "receivables", subview: "adjustments" };
    case "supplier-payables": return { view: "payables" };
    case "reconciliation": return { view: "reconciliation" };
    default: return { view: "receivables", subview: "balances" };
  }
}
