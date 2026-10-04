"use client";

import PageHeader from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { BarChart3 } from "lucide-react";

import { formatExactCurrency } from "@/app/(main)/departure-groups/utils";
import type { CampaignWithMetrics } from "@/lib/types/campaigns";
import type { AudienceWithSize } from "@/lib/types/audiences";
import type { ReferralWithReferrer, ReferrerWithMetrics } from "@/lib/types/referrals";
import type { LoyaltyPilgrimSummary } from "@/lib/types/loyalty";
import type { SalesAgentWithMetrics } from "@/lib/types/agent-portal";
import type { SurveyWithStats } from "@/lib/types/feedback";

interface AnalyticsViewProps {
  campaigns: CampaignWithMetrics[];
  audiences: AudienceWithSize[];
  referrers: ReferrerWithMetrics[];
  referrals: ReferralWithReferrer[];
  loyaltyPilgrims: LoyaltyPilgrimSummary[];
  agents: SalesAgentWithMetrics[];
  surveys: SurveyWithStats[];
}

export default function AnalyticsView({
  campaigns,
  audiences,
  referrers,
  referrals,
  loyaltyPilgrims,
  agents,
  surveys,
}: AnalyticsViewProps) {
  const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE").length;
  const campaignRevenue = campaigns.reduce((sum, c) => sum + c.metrics.revenue, 0);
  const campaignSpend = campaigns.reduce((sum, c) => sum + c.metrics.totalSpend, 0);
  const totalAudienceReach = audiences.reduce((sum, a) => sum + a.liveCount, 0);

  const convertedReferrals = referrals.filter((r) => r.status === "CONVERTED").length;
  const referralConversionRate = referrals.length > 0 ? convertedReferrals / referrals.length : 0;

  const repeatPilgrims = loyaltyPilgrims.filter((p) => p.isRepeat).length;
  const repeatRate = loyaltyPilgrims.length > 0 ? repeatPilgrims / loyaltyPilgrims.length : 0;

  const activeAgents = agents.filter((a) => a.status === "ACTIVE").length;
  const agentConverted = agents.reduce((sum, a) => sum + a.metrics.convertedCount, 0);
  const pendingCommission = agents.reduce((sum, a) => sum + a.metrics.pendingCommission, 0);

  const scoredSurveys = surveys.filter((s) => s.averageScore !== null);
  const overallSatisfaction =
    scoredSurveys.length > 0 ? scoredSurveys.reduce((sum, s) => sum + (s.averageScore ?? 0), 0) / scoredSurveys.length : null;

  const hasAnyData =
    campaigns.length > 0 ||
    audiences.length > 0 ||
    referrers.length > 0 ||
    loyaltyPilgrims.length > 0 ||
    agents.length > 0 ||
    surveys.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        breadcrumb={[{ title: "Insights", link: "#" }, { title: "Analytics", link: "/analytics" }]}
        subTitle="Cross-cut over Campaigns, Audiences, Referrals, Loyalty, Agent Portal and Feedback — every number here is read live from its own module."
        action={null}
      />

      {!hasAnyData ? (
        <EmptyState
          icon={<BarChart3 className="size-8" />}
          title="Nothing to analyze yet"
          description="Once Campaigns, Referrals, Loyalty or Agent Portal have real activity, it shows up here automatically."
        />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">Campaigns & Audiences</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard title="Active campaigns" value={String(activeCampaigns)} />
              <KpiCard title="Attributed revenue" value={formatExactCurrency(campaignRevenue)} />
              <KpiCard title="Campaign spend" value={formatExactCurrency(campaignSpend)} />
              <KpiCard title="Total audience reach" value={String(totalAudienceReach)} />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">Referrals</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard title="Referrers" value={String(referrers.length)} />
              <KpiCard title="Referrals logged" value={String(referrals.length)} />
              <KpiCard title="Converted" value={String(convertedReferrals)} />
              <KpiCard title="Conversion rate" value={`${Math.round(referralConversionRate * 100)}%`} />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">Loyalty & repeat pilgrims</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard title="Pilgrims tracked" value={String(loyaltyPilgrims.length)} />
              <KpiCard title="Repeat pilgrims" value={String(repeatPilgrims)} />
              <KpiCard title="Repeat rate" value={`${Math.round(repeatRate * 100)}%`} />
              <KpiCard title="Avg. survey score" value={overallSatisfaction !== null ? overallSatisfaction.toFixed(1) : "—"} />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">Agent Portal</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard title="Active agents" value={String(activeAgents)} />
              <KpiCard title="Agent-sourced bookings" value={String(agentConverted)} />
              <KpiCard title="Pending commission" value={formatExactCurrency(pendingCommission)} />
              <KpiCard title="Total agents" value={String(agents.length)} />
            </div>
          </section>

          {referrers.length > 0 && (
            <section className="flex flex-col gap-3">
              <p className="text-sm font-medium text-foreground">Top referrers</p>
              <Card className="p-0 overflow-x-auto no-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-none!">
                      {["Referrer", "Referrals", "Converted", "Rewards"].map((label) => (
                        <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                          {label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-border/20">
                    {[...referrers]
                      .sort((a, b) => b.metrics.convertedCount - a.metrics.convertedCount)
                      .slice(0, 5)
                      .map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="px-3 py-3 text-sm text-foreground">{r.name}</TableCell>
                          <TableCell className="px-3 py-3 text-xs font-number text-foreground">{r.metrics.referralCount}</TableCell>
                          <TableCell className="px-3 py-3 text-xs font-number text-foreground">{r.metrics.convertedCount}</TableCell>
                          <TableCell className="px-3 py-3 text-sm text-foreground">{formatExactCurrency(r.metrics.totalRewardAmount)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
