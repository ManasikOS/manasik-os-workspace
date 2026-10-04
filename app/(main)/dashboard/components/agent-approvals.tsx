"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { AgencyOpenProposal, CopilotDailySummary } from "@/lib/data/departure-groups-agent";

import ProposalDecisionDialog from "@/app/(main)/departure-groups/[groupId]/components/proposal-decision-dialog";
import { riskTone } from "@/app/(main)/departure-groups/components/agent-tone";
import { relativeTimestamp } from "@/app/(main)/departure-groups/utils";

/**
 * The Departure Operations Agent's top-risk-first proposals (§5.7) — the
 * queue that otherwise only surfaces at `/operations/approvals`. Reuses
 * `ProposalDecisionDialog` verbatim rather than building a second
 * approve/reject flow: same capability checks, same risk-note requirement.
 */
export default function AgentApprovals({
  totalCount,
  top,
  role,
  daily,
}: {
  totalCount: number;
  top: AgencyOpenProposal[];
  role: StaffRole;
  daily?: CopilotDailySummary | null;
}) {
  const [reviewing, setReviewing] = useState<AgencyOpenProposal | null>(null);

  return (
    <Card className="p-5 flex flex-col gap-4 h-full">
      <ProposalDecisionDialog proposal={reviewing} role={role} open={!!reviewing} onClose={() => setReviewing(null)} />

      <div>
        <SectionHeading
          title="Copilot Approvals"
          act={
            <Button variant="link" size="sm" className="h-5 p-0 text-xs font-medium gap-1" render={<Link href="/operations/approvals" />}>
              <span>{totalCount > top.length ? `View all ${totalCount}` : "View queue"}</span>
              <ArrowRight className="size-3.5" />
            </Button>
          }
        />
        <p className="text-xs text-muted-foreground mt-0.5">What Manasik Copilot is waiting on you to decide.</p>
        {daily && (daily.completedToday > 0 || daily.proposalsRaisedToday > 0 || daily.leadsMatchedToday > 0) && (
          <p className="text-xs text-muted-foreground mt-1">
            Today:{" "}
            {[
              daily.completedToday > 0
                ? `${daily.completedToday} approved request${daily.completedToday === 1 ? "" : "s"} completed`
                : null,
              daily.proposalsRaisedToday > 0
                ? `${daily.proposalsRaisedToday} new request${daily.proposalsRaisedToday === 1 ? "" : "s"} raised`
                : null,
              daily.leadsMatchedToday > 0
                ? `${daily.leadsMatchedToday} lead${daily.leadsMatchedToday === 1 ? "" : "s"} matched to a group`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>

      {top.length === 0 ? (
        <EmptyState title="Nothing waiting" description="Manasik Copilot has nothing open right now." icon={<Sparkles className="size-5" />} />
      ) : (
        <div className="flex flex-col gap-2">
          {top.map((p) => (
            <Card key={p.id} className="bg-card/50! gap-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ToneBadge tone={riskTone(p.risk)} label={`${p.risk} risk`} />
                  <span className="text-xs text-muted-foreground">
                    {p.groupName} ({p.groupCode})
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">Expires {relativeTimestamp(p.expiresAt)}</span>
              </div>
              <p className="text-xs font-medium text-foreground">{p.title}</p>
              <div className="flex justify-end">
                <Button variant="outline" size="xs" className="h-7 text-xs" onClick={() => setReviewing(p)}>
                  Review
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}
