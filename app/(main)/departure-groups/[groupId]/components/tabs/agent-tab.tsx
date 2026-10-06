"use client";

/**
 * The Agent tab — §12.1 of
 * docs/modules/departure-operations-agent-implementation-plan.md. Everything the
 * Departure Operations Agent has concluded about this group, and every
 * proposal waiting on a human. Nothing here is computed client-side beyond
 * formatting — every finding and every proposal is a row `getGroupAgentPanel()`
 * already read.
 */

import { AlarmClockOff, BellOff, ChevronRight, Sparkles } from "lucide-react";
import React, { useState, useTransition } from "react";

import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import type { GroupAgentPanel, GroupAgentProposal } from "@/lib/data/departure-groups-agent";

import { setGroupAgentSuppressionAction } from "../../../agent-proposal-actions";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import { proposalStatusTone, riskTone, severityTone } from "../../../components/agent-tone";
import { formatDateTime, relativeTimestamp } from "../../../utils";
import ProposalDecisionDialog from "../proposal-decision-dialog";

interface AgentTabProps {
  groupId: string;
  panel: GroupAgentPanel;
  role: StaffRole;
}

const MODE_LABELS: Record<string, string> = {
  OFF: "Off",
  SHADOW: "Shadow (reviews, never writes)",
  PROPOSE: "Propose (asks before anything external)",
  ACTIVE: "Active",
};

const SUPPRESS_OPTIONS = [
  { label: "Mute for 7 days", days: 7 },
  { label: "Mute for 30 days", days: 30 },
  { label: "Mute for 90 days", days: 90 },
];

/** `Date.now()` read out of the render body proper, matching the pattern already used elsewhere (e.g. suppliers' activity-tab.tsx `relativeTime`) so the purity lint doesn't flag it. */
function isFutureTimestamp(iso: string): boolean {
  return Date.parse(iso) > Date.now();
}

const AgentTab = ({ groupId, panel, role }: AgentTabProps) => {
  const can = useDepartureCapabilities(role);
  const [isPending, startTransition] = useTransition();
  const [reviewing, setReviewing] = useState<GroupAgentProposal | null>(null);

  const isSuppressed = !!panel.state?.suppressedUntil && isFutureTimestamp(panel.state.suppressedUntil);

  const mute = (days: number) => {
    startTransition(async () => {
      const result = await setGroupAgentSuppressionAction(groupId, { days, reason: "Muted from the Agent tab." });
      if (!result.ok) {
        toast.add({ title: "Could not mute Manasik Copilot", description: result.error });
        return;
      }
      toast.add({ title: `Manasik Copilot muted for ${days} days` });
    });
  };

  const unmute = () => {
    startTransition(async () => {
      const result = await setGroupAgentSuppressionAction(groupId, { days: null, reason: "" });
      if (!result.ok) {
        toast.add({ title: "Could not unmute Manasik Copilot", description: result.error });
        return;
      }
      toast.add({ title: "Manasik Copilot unmuted" });
    });
  };

  if (!panel.state && !panel.latestRun) {
    return (
      <EmptyState
        title="Manasik Copilot hasn’t looked at this group yet"
        description="Manasik Copilot hasn't reviewed this group yet — it will be picked up on its next scheduled sweep."
      />
    );
  }

  return (
    <>
      <ProposalDecisionDialog proposal={reviewing} role={role} open={!!reviewing} onClose={() => setReviewing(null)} />

      <div className="flex flex-col gap-6">
        {/* Header strip */}
        <Card className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Manasik Copilot</h3>
              {panel.state && (
                <ToneBadge
                  tone={panel.state.effectiveMode === "ACTIVE" ? "success" : panel.state.effectiveMode === "OFF" ? "neutral" : "info"}
                  label={MODE_LABELS[panel.state.effectiveMode] ?? panel.state.effectiveMode}
                />
              )}
              {isSuppressed && <ToneBadge tone="warning" label="Muted" />}
            </div>

            {can.manageReadiness && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline_without_border" size="sm" disabled={isPending}>
                    <BellOff className="size-3.5" /> {isSuppressed ? "Muted" : "Mute Copilot"} <ChevronRight className="size-3.5" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {isSuppressed ? (
                  <DropdownMenuItem onClick={unmute}>
                    <AlarmClockOff /> Unmute now
                  </DropdownMenuItem>
                ) : (
                  SUPPRESS_OPTIONS.map((opt) => (
                    <DropdownMenuItem key={opt.days} onClick={() => mute(opt.days)}>
                      {opt.label}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </div>

          {panel.state?.suppressedReason && isSuppressed && (
            <p className="text-xs text-muted-foreground">
              Muted until {formatDateTime(panel.state.suppressedUntil)} — {panel.state.suppressedReason}
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs text-muted-foreground">
            <div>
              <p className="text-[11px] uppercase tracking-wide">Last reviewed</p>
              <p className="text-foreground font-medium">
                {panel.state?.lastRunAt ? relativeTimestamp(panel.state.lastRunAt) : "Never"}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide">Next review</p>
              <p className="text-foreground font-medium">
                {panel.state ? formatDateTime(panel.state.nextRunAt) : "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide">Consecutive quiet runs</p>
              <p className="text-foreground font-medium">{panel.state?.consecutiveNoopRuns ?? 0}</p>
            </div>
          </div>
        </Card>

        {/* Latest review */}
        {panel.latestRun && (
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">
              Latest review — {relativeTimestamp(panel.latestRun.createdAt)}
            </p>
            {panel.latestRun.status === "NOOP" ? (
              <p className="text-sm text-muted-foreground">Nothing had changed since the last review — no findings raised.</p>
            ) : panel.latestRun.status !== "OK" ? (
              <p className="text-sm text-destructive">
                This run did not complete cleanly ({panel.latestRun.status}){panel.latestRun.error ? `: ${panel.latestRun.error}` : "."}
              </p>
            ) : panel.latestRun.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No findings this run — nothing worth flagging.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {panel.latestRun.findings.map((f) => (
                  <Card key={f.id} className="gap-1.5 p-3">
                    <div className="flex items-center gap-2">
                      <ToneBadge tone={severityTone(f.severity)} label={f.severity} />
                      <span className="text-xs text-muted-foreground">{f.category}</span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{f.headline}</p>
                    <p className="text-xs text-muted-foreground">{f.detail}</p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Pending approvals */}
        <div>
          <p className="text-sm font-semibold text-foreground mb-2">
            Pending approvals {panel.openProposals.length > 0 && `(${panel.openProposals.length})`}
          </p>
          {panel.openProposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting on a decision.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {panel.openProposals.map((p) => (
                <Card key={p.id} className="gap-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ToneBadge tone={riskTone(p.risk)} label={`${p.risk} risk`} />
                      {p.status === "APPROVED" && <ToneBadge tone="info" label="Approving…" />}
                    </div>
                    <span className="text-[11px] text-muted-foreground">Expires {relativeTimestamp(p.expiresAt)}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground">{p.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{p.rationale}</p>
                  <div>
                    <Button variant="outline_without_border" size="sm" onClick={() => setReviewing(p)}>
                      <Sparkles className="size-3.5" /> Review
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Recent decisions */}
        {panel.recentDecisions.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">Recent decisions</p>
            <div className="flex flex-col gap-1.5">
              {panel.recentDecisions.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-xs border-b py-1.5 last:border-0">
                  <span className="text-foreground truncate">{p.title}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <ToneBadge tone={proposalStatusTone(p.status)} label={p.status.replace(/_/g, " ")} />
                    <span className="text-muted-foreground">{p.decidedAt ? relativeTimestamp(p.decidedAt) : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default AgentTab;
