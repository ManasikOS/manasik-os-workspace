import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  ChevronRight,
  FileSearch,
  FileQuestion,
} from "lucide-react";

import SectionHeading from "@/components/section-heading";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/tone-badge";
import { TONE_BORDER, TONE_CLASS, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import type { AttentionRow } from "@/lib/types/dashboard";

const SEVERITY_TONE: Record<AttentionRow["severity"], Tone> = {
  critical: "danger",
  warning: "warning",
  info: "info",
};

/**
 * The Attention Rail (§5.4) — one ranked list of everything across the
 * agency's active groups, leads and receivables that needs a decision.
 * Replaces the old Documents & Visa Exceptions panel plus the orphaned
 * Lead Attention and Operational Alerts panels Phase 0 removed. Rows arrive
 * pre-ranked from `rankAttentionRows()` — this component only renders them.
 */
export default function AttentionRail({ rows }: { rows: AttentionRow[] }) {
  const styleFor = (severity: AttentionRow["severity"]) => {
    const tone = SEVERITY_TONE[severity];
    const iconClass = cn("size-4 shrink-0", TONE_TEXT[tone]);
    const icon =
      severity === "critical" ? (
        <AlertCircle className={iconClass} />
      ) : severity === "warning" ? (
        <FileQuestion className={iconClass} />
      ) : (
        <FileSearch className={iconClass} />
      );
    return {
      icon,
      badge: cn(TONE_CLASS[tone], "font-bold"),
      border: TONE_BORDER[tone],
    };
  };

  return (
    <Card className="p-5 flex flex-col gap-4 h-full">
      <div>
        <SectionHeading
          title="Needs Attention"
          act={
            <Button
              variant="link"
              size="sm"
              className="h-5 p-0 text-xs font-medium gap-1"
              render={<Link href="/operations" />}
            >
              <span>Open Operations</span>
              <ArrowRight className="size-3.5" />
            </Button>
          }
        />
        <p className="text-xs text-muted-foreground mt-0.5">
          Ranked by how soon it bites, most urgent first.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="All clear"
          description="Nothing across your groups, leads or receivables needs attention right now."
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((item) => {
            const style = styleFor(item.severity);
            return (
              <Link
                key={item.id}
                href={item.destination}
                className="block group outline-none"
              >
                <Card
                  className={`bg-card/50! flex-row hover:bg-input/40! transition-all flex items-center justify-between gap-3 group-focus-visible:ring-2 group-focus-visible:ring-ring ${style.border}`}
                >
                  <div className="flex items-center gap-3">
                    {style.icon}
                    <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                      {item.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs tabular-nums ${style.badge}`}
                    >
                      {item.count}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}
