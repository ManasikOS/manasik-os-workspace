"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WhatsAppBillingBudgetRow, WhatsAppVolumeTierRow } from "@/lib/types/whatsapp";
import type { BillingSummary } from "@/lib/data/whatsapp-billing-view";

import { saveBillingBudget } from "./actions";

const chartConfig = {
  cost: { label: "Cost", color: "var(--primary)" },
} satisfies ChartConfig;

function formatMoney(value: number, currency: string | null): string {
  if (!currency) return value.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function BillingDashboard({
  summary,
  budget,
  tiers,
  canEditBudget,
  hasData,
}: {
  summary: BillingSummary;
  budget: WhatsAppBillingBudgetRow | null;
  tiers: WhatsAppVolumeTierRow[];
  canEditBudget: boolean;
  hasData: boolean;
}) {
  const [monthlyBudget, setMonthlyBudget] = useState(budget?.monthly_budget?.toString() ?? "");
  const [currency, setCurrency] = useState(budget?.currency ?? summary.currency ?? "USD");
  const [blockAt100, setBlockAt100] = useState(budget?.block_marketing_at_100 ?? false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const budgetPercent = budget?.monthly_budget ? Math.min(100, Math.round((summary.monthToDateCost / budget.monthly_budget) * 100)) : null;

  async function handleSaveBudget() {
    setBusy(true);
    const result = await saveBillingBudget({
      monthlyBudget: monthlyBudget.trim() ? Number(monthlyBudget) : null,
      currency,
      blockMarketingAt100: blockAt100,
    });
    setMessage(result.ok ? "Budget saved." : result.error);
    setBusy(false);
  }

  if (!hasData) {
    return <p className="text-sm text-muted-foreground">Connect WhatsApp under Integrations to see usage and billing here.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header — month to date, with the standing D10 caveat */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Month to date (Meta&apos;s figures)</p>
          <p className="text-2xl font-semibold mt-1">{formatMoney(summary.monthToDateCost, summary.currency)}</p>
          {budgetPercent !== null && (
            <p className="text-xs text-muted-foreground mt-1">{budgetPercent}% of {formatMoney(budget!.monthly_budget!, budget!.currency)} budget</p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">AI agent cost (all-in, D12)</p>
          <p className="text-2xl font-semibold mt-1">{formatMoney(summary.aiCostUsd, "USD")}</p>
          <p className="text-xs text-muted-foreground mt-1">{summary.aiConversationCount} conversation{summary.aiConversationCount === 1 ? "" : "s"} this month</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Reconciliation</p>
          <p className="text-2xl font-semibold mt-1">
            {summary.metaVsAttributedVariance === null ? "—" : formatMoney(Math.abs(summary.metaVsAttributedVariance), summary.currency)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {summary.metaVsAttributedVariance === null
              ? "No data yet"
              : summary.metaVsAttributedVariance > 0.01
                ? "Meta reports more than the CRM attributed — some messages may be sent outside the CRM"
                : "Meta's figure and the CRM's attribution agree"}
          </p>
        </Card>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Meta&apos;s analytics are approximate and may differ from your invoice — WhatsApp Manager is the billing
        record of last resort. This screen is for visibility and attribution, not for reconciling to the cent.
      </p>

      {/* Trend */}
      {summary.daily.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-medium mb-3">Daily spend (last 30 days)</p>
          <ChartContainer config={chartConfig} className="h-56 w-full">
            <BarChart data={summary.daily}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={(v: string) => v.slice(5)} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="cost" fill="var(--color-cost)" radius={4} />
            </BarChart>
          </ChartContainer>
        </Card>
      )}

      {/* Breakdown tables */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BreakdownCard title="By category" rows={summary.byCategory} currency={summary.currency} />
        <BreakdownCard title="By country" rows={summary.byCountry} currency={summary.currency} />
        <BreakdownCard title="By pricing type" rows={summary.byPricingType} currency={summary.currency} />
      </div>

      {/* Volume tiers */}
      {tiers.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-medium mb-3">Volume tiers</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Range</TableHead>
                <TableHead>Effective</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.pricing_category}</TableCell>
                  <TableCell>{t.region || "—"}</TableCell>
                  <TableCell>
                    {t.tier_lower ?? "?"}–{t.tier_upper ?? "?"}
                  </TableCell>
                  <TableCell>{t.effective_month ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Budget */}
      <Card className="p-4">
        <p className="text-sm font-medium mb-3">Monthly budget and alerts</p>
        {canEditBudget ? (
          <div className="flex flex-col gap-3 max-w-sm">
            <div className="flex gap-2">
              <Input placeholder="e.g. 500" value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} />
              <Input className="w-24" placeholder="USD" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={blockAt100} onChange={(e) => setBlockAt100(e.target.checked)} />
              Block marketing template sends once 100% of budget is reached (never blocks replies to customers or
              utility/authentication templates)
            </label>
            <Button size="sm" disabled={busy} onClick={handleSaveBudget} className="self-start">
              Save
            </Button>
            {message && <p className="text-xs text-muted-foreground">{message}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {budget?.monthly_budget ? `Alerting at ${formatMoney(budget.monthly_budget, budget.currency)}/month.` : "No budget set."}
          </p>
        )}
      </Card>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: { category: string; cost: number; volume: number }[];
  currency: string | null;
}) {
  return (
    <Card className="p-4">
      <p className="text-sm font-medium mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.slice(0, 8).map((r) => (
            <div key={r.category} className="flex items-center justify-between text-xs">
              <Badge variant="outline" className="font-normal">
                {r.category}
              </Badge>
              <span className="text-muted-foreground">
                {formatMoney(r.cost, currency)} · {r.volume} msgs
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
