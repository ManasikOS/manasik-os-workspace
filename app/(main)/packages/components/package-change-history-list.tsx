"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ToneBadge } from "@/components/ui/tone-badge";
import type { Tone } from "@/lib/ui/tone";
import type { PackageContentColumn } from "@/lib/access/package-field-tiers";
import type { PackageChangeRequest, PackageChangeRequestStatus } from "@/lib/data/packages-repository";
import { PACKAGE_COLUMN_LABELS } from "@/lib/packages/change-diff";

import PackageChangeDiffView from "./package-change-diff-view";

/**
 * The past reviewed changes to one package (TASK-043): who asked, who decided, why, and the before and after of each field. Shown on the Activity tab.
 */

const STATUS_LABEL: Record<PackageChangeRequestStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Waiting for approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  APPLIED: { label: "Applied", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  SUPERSEDED: { label: "Replaced by a newer request", tone: "neutral" },
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function whoDecided(request: PackageChangeRequest): string | null {
  if (request.status === "APPLIED") return "Applied straight away, because approval is switched off";
  if (request.status === "WITHDRAWN") return `Withdrawn${request.decidedAt ? ` on ${formatWhen(request.decidedAt)}` : ""}`;
  if (request.status === "EXPIRED") return "Nobody decided it in time";
  if (request.status === "SUPERSEDED") return "Replaced when a newer change was sent";
  if (!request.decidedByName) return null;
  const verb = request.status === "REJECTED" ? "Rejected" : "Approved";
  return `${verb} by ${request.decidedByName}${request.decidedAt ? ` on ${formatWhen(request.decidedAt)}` : ""}`;
}

function HistoryItem({ request }: { request: PackageChangeRequest }) {
  const [open, setOpen] = useState(false);
  const status = STATUS_LABEL[request.status] ?? { label: request.status, tone: "neutral" as Tone };
  const decision = whoDecided(request);
  const columns = Object.entries(request.changes);

  return (
    <li className="rounded-sm border border-border/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={status.tone} label={status.label} />
        <span className="text-[11px] text-muted-foreground">
          {request.requestedByName} asked on {formatWhen(request.createdAt)}
        </span>
      </div>
      {request.reason && <p className="mt-1 text-sm text-foreground">Why: {request.reason}</p>}
      {decision && <p className="mt-1 text-[11px] text-muted-foreground">{decision}</p>}
      {request.decisionNote && <p className="mt-1 text-[11px] text-muted-foreground">Note: {request.decisionNote}</p>}

      {columns.length > 0 && (
        <>
          <Button variant="outline_without_border" className="mt-2" onClick={() => setOpen((current) => !current)}>
            {open ? "Hide changes" : `Show ${columns.length} changed field${columns.length === 1 ? "" : "s"}`}
          </Button>
          {open && (
            <div className="mt-2 flex flex-col gap-3">
              {columns.map(([column, change]) => (
                <div key={column} className="rounded-sm border border-border/50 p-3">
                  <PackageChangeDiffView
                    label={PACKAGE_COLUMN_LABELS[column as PackageContentColumn] ?? column}
                    before={change.old}
                    after={change.new}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </li>
  );
}

export default function PackageChangeHistoryList({ history }: { history: PackageChangeRequest[] }) {
  if (history.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">Changes to payment and booking terms</h3>
      <ul className="flex flex-col gap-2">
        {history.map((request) => (
          <HistoryItem key={request.id} request={request} />
        ))}
      </ul>
    </div>
  );
}
