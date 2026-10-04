import Link from "next/link";
import { ArrowRight, AlertCircle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import type {
  ApprovalsSummary,
  AttentionRow,
  StatusLine,
} from "@/lib/types/dashboard";
import type { CopilotDailySummary } from "@/lib/data/departure-groups-agent";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import TextLabel from "@/components/ui/text-label";

const ROLE_BRIEFING_LABEL: Record<StaffRole, string> = {
  ADMIN: "Agency overview",
  CEO: "Executive overview",
  FINANCE: "Cash and collections overview",
  MARKETING: "Demand and conversion overview",
  OPERATIONS: "Operations overview",
  VISA: "Visa readiness overview",
  GUIDE: "Today’s group overview",
};

/**
 * The dashboard's single AI-summarised hero panel — the "control center"
 * headline the rest of the grid backs up with detail. Every sentence here is
 * assembled from figures already computed elsewhere (`StatusLine`'s own
 * message, the top of the already-ranked Attention Rail, the Copilot's daily
 * activity counts); this component composes prose around them, it never
 * derives a number of its own — same discipline as `StatusLine` itself
 * (docs/modules/dashboard-module-implementation-plan.md §5.1).
 */
export default function AiBriefing({
  staffName,
  role,
  status,
  attentionRail,
  approvals,
  daily,
}: {
  staffName: string | null;
  role: StaffRole;
  status: StatusLine;
  attentionRail: AttentionRow[];
  approvals: ApprovalsSummary | null;
  daily: CopilotDailySummary | null;
}) {
  const topRows = attentionRail.slice(0, 3);
  const greetingName = staffName?.includes("@") ? null : staffName;
  const dailyLine =
    daily &&
    (daily.completedToday > 0 ||
      daily.proposalsRaisedToday > 0 ||
      daily.leadsMatchedToday > 0)
      ? [
          daily.completedToday > 0
            ? `completed ${daily.completedToday} approved request${daily.completedToday === 1 ? "" : "s"}`
            : null,
          daily.proposalsRaisedToday > 0
            ? `raised ${daily.proposalsRaisedToday} new proposal${daily.proposalsRaisedToday === 1 ? "" : "s"}`
            : null,
          daily.leadsMatchedToday > 0
            ? `matched ${daily.leadsMatchedToday} lead${daily.leadsMatchedToday === 1 ? "" : "s"} to a group`
            : null,
        ]
          .filter(Boolean)
          .join(", ")
      : null;

  return (
    <Card className="relative overflow-hidden px-5 py-5 pt-4 flex flex-col gap-0 border-primary/15 bg-linear-to-br from-primary/[0.07] via-card to-card">
      <h2 className="text-2xl font-semibold">
        <span className="font-arabic">السلام عليكم</span>
        {greetingName && <span className="ml-1 text-3xl text-primary">{greetingName}</span>}
      </h2>

      <div className="mt-4">
        <TextLabel label={ROLE_BRIEFING_LABEL[role]} />
      </div>
      <div className="flex items-start mt-2 justify-between gap-3">
        {/* <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex items-center justify-center size-9 rounded-lg bg-linear-to-br from-primary to-accent text-white shadow-sm shrink-0">
            <Sparkles className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              Manasik Copilot briefing
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Today&apos;s summary, assembled from every panel below
            </p>
          </div>
        </div> */}
        {approvals && approvals.totalCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1 shrink-0"
            render={<Link href="/operations/approvals" />}
          >
            <span>{approvals.totalCount} awaiting approval</span>
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      </div>

      <p className="text-base font-medium text-foreground leading-snug">
        {status.message}
      </p>

      {topRows.length > 0 && (
        <ul className="flex flex-wrap gap-5 mt-3">
          {topRows.map((row) => (
            <li key={row.id}>
              <Link
                href={row.destination}
                className="group flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <AlertCircle
                  className={cn(
                    "size-3.5 shrink-0",
                    TONE_TEXT[
                      row.severity === "critical"
                        ? "danger"
                        : row.severity === "warning"
                          ? "warning"
                          : "info"
                    ],
                  )}
                />
                <span className="group-hover:underline">{row.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {dailyLine && (
        <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-3">
          Copilot today: {dailyLine}.
        </p>
      )}
    </Card>
  );
}
