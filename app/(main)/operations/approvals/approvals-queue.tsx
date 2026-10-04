"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";
import React, { useMemo, useState } from "react";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { AgencyOpenProposal } from "@/lib/data/departure-groups-agent";

import ProposalDecisionDialog from "@/app/(main)/departure-groups/[groupId]/components/proposal-decision-dialog";
import { riskTone } from "@/app/(main)/departure-groups/components/agent-tone";
import { relativeTimestamp } from "@/app/(main)/departure-groups/utils";

const RISK_FILTERS = ["ALL", "HIGH", "MEDIUM", "LOW"] as const;
type RiskFilter = (typeof RISK_FILTERS)[number];

export default function ApprovalsQueue({
  proposals,
  role,
}: {
  proposals: AgencyOpenProposal[];
  role: StaffRole;
}) {
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("ALL");
  const [reviewing, setReviewing] = useState<AgencyOpenProposal | null>(null);

  const filtered = useMemo(
    () => (riskFilter === "ALL" ? proposals : proposals.filter((p) => p.risk === riskFilter)),
    [proposals, riskFilter],
  );

  const counts = useMemo(() => {
    const byRisk: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const p of proposals) byRisk[p.risk] = (byRisk[p.risk] ?? 0) + 1;
    return byRisk;
  }, [proposals]);

  return (
    <div className="flex flex-col gap-6">
      <ProposalDecisionDialog proposal={reviewing} role={role} open={!!reviewing} onClose={() => setReviewing(null)} />

      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Operations", link: "/operations" },
          { title: "Copilot Approvals", link: "/operations/approvals" },
        ]}
        title="Manasik Copilot — Approvals"
        subTitle="Everything Manasik Copilot has raised across your groups that nobody has decided on yet."
        action={null}
      />

      <div className="flex flex-wrap items-center gap-2">
        {RISK_FILTERS.map((f) => (
          <Button
            key={f}
            variant={riskFilter === f ? "secondary" : "outline_without_border"}
            size="sm"
            onClick={() => setRiskFilter(f)}
          >
            {f === "ALL" ? `All (${proposals.length})` : `${f} (${counts[f] ?? 0})`}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing waiting on a decision"
          description={proposals.length === 0 ? "The agent has no open proposals right now." : "No proposals match this filter."}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((p) => (
            <Card key={p.id} className="gap-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ToneBadge tone={riskTone(p.risk)} label={`${p.risk} risk`} />
                  <Link
                    href={`/departure-groups/${p.groupId}?tab=agent`}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {p.groupName} ({p.groupCode})
                  </Link>
                </div>
                <span className="text-[11px] text-muted-foreground">Expires {relativeTimestamp(p.expiresAt)}</span>
              </div>
              <p className="text-sm font-medium text-foreground">{p.title}</p>
              <p className="text-xs text-muted-foreground line-clamp-2">{p.rationale}</p>
              <div>
                <Button variant="outline_without_border" size="sm" onClick={() => setReviewing(p)}>
                  <Sparkles className="size-3.5" /> Review <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
