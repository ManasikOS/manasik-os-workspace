"use client";

import React, { useMemo } from "react";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { computeFinanceKpis } from "@/lib/data/finance";
import type { FinanceTabId } from "@/lib/access/finance-access";

import { useFinance } from "../../finance-store";
import FinanceCashRiskBriefing from "../../../components/finance-overview-view";
import FinanceExceptionQueue from "../finance-exception-queue";
import FinanceMetrics from "../finance-metrics";

interface OverviewTabProps {
  onNavigate: (tab: FinanceTabId) => void;
  onOpenDepartureSafety: () => void;
}

export default function OverviewTab({ onNavigate, onOpenDepartureSafety }: OverviewTabProps) {
  const { snapshot, can } = useFinance();
  const kpis = useMemo(() => computeFinanceKpis(snapshot.receivables, snapshot.payments, snapshot.supplierPayables, snapshot.refundsPendingAmount, snapshot.refundsPendingCount, snapshot.nowIso), [snapshot]);

  if (can.viewPaymentStatusOnly) {
    return (
        <FinanceExceptionQueue items={snapshot.exceptions.items} />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FinanceMetrics kpis={kpis} can={can} onOpen={onNavigate} />
      {can.viewSupplierPayables && (
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeading
            title="Departure safety"
            description={`${snapshot.departureFinancialSafety.filter((result) => result.status !== "HEALTHY").length} active departure${snapshot.departureFinancialSafety.filter((result) => result.status !== "HEALTHY").length === 1 ? "" : "s"} need review. Each result is source-backed and currency-separated.`}
          />
          <Button variant="outline" onClick={onOpenDepartureSafety}>Review departure safety</Button>
        </Card>
      )}
      <FinanceExceptionQueue items={snapshot.exceptions.items} />
      {can.viewLedger && <FinanceCashRiskBriefing />}
    </div>
  );
}
