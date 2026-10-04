"use client";

import { useMemo, useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import { KpiCard } from "@/components/data-table/kpi-card";
import { BrainCircuit, RefreshCw } from "lucide-react";

import { formatDateTime } from "@/app/(main)/departure-groups/utils";
import type {
  InsightOutcomeType,
  InsightSeverity,
  InsightSubjectType,
  InsightWithEvidence,
} from "@/lib/types/insights";
import type { Tone } from "@/lib/ui/tone";

import {
  recordInsightOutcomeAction,
  runInsightGeneratorsAction,
} from "../actions";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

const SEVERITY_TONE: Record<InsightSeverity, Tone> = {
  INFO: "neutral",
  WARNING: "warning",
  CRITICAL: "danger",
};

function subjectLink(
  subjectType: InsightSubjectType,
  subjectId: string,
): string | null {
  switch (subjectType) {
    case "LEAD":
      return `/leads?open=${subjectId}`;
    case "PILGRIM":
      return `/pilgrims/${subjectId}`;
    case "DEPARTURE_GROUP":
      return `/departure-groups/${subjectId}`;
    case "CAMPAIGN":
      return `/campaigns/${subjectId}`;
    default:
      return null;
  }
}

type FilterKey = "OPEN" | "ALL";

interface AiInsightsViewProps {
  insights: InsightWithEvidence[];
  canManage: boolean;
}

export default function AiInsightsView({
  insights,
  canManage,
}: AiInsightsViewProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("OPEN");
  const [refreshing, setRefreshing] = useState(false);
  const [actOn, setActOn] = useState<InsightWithEvidence | null>(null);

  const filtered = useMemo(
    () =>
      filter === "OPEN"
        ? insights.filter(
            (i) => i.status === "OPEN" || i.status === "ACKNOWLEDGED",
          )
        : insights,
    [insights, filter],
  );

  const openCount = insights.filter((i) => i.status === "OPEN").length;
  const criticalCount = insights.filter(
    (i) => i.status === "OPEN" && i.severity === "CRITICAL",
  ).length;
  const resolvedCount = insights.filter((i) => i.status === "RESOLVED").length;

  const refresh = async () => {
    setRefreshing(true);
    const result = await runInsightGeneratorsAction();
    setRefreshing(false);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not refresh insights" });
      return;
    }
    toast.add({
      title: `${result.generated ?? 0} insight${result.generated === 1 ? "" : "s"} refreshed`,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI Insights"
        breadcrumb={[
          { title: "Insights", link: "#" },
          { title: "AI Insights", link: "/ai-insights" },
        ]}
        subTitle="Deterministic rule generators over existing data — every insight is explainable, none of it comes from a model call."
        action={
          canManage && (
            <Button onClick={refresh} disabled={refreshing}>
              <RefreshCw
                className={refreshing ? "size-4 animate-spin" : "size-4"}
              />{" "}
              Refresh insights
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Open insights" value={String(openCount)} />
        <KpiCard title="Critical" value={String(criticalCount)} />
        <KpiCard title="Resolved" value={String(resolvedCount)} />
        <KpiCard title="Total tracked" value={String(insights.length)} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(["OPEN", "ALL"] as const).map((key) => (
          <Badge
            key={key}
            variant={filter === key ? "default" : "secondary"}
            className="cursor-pointer"
            onClick={() => setFilter(key)}
          >
            {key === "OPEN" ? "Open & acknowledged" : "All"}
          </Badge>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<BrainCircuit className="size-8" />}
          title="No insights right now"
          description={
            canManage
              ? 'Click "Refresh insights" to run the generators against current data.'
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((insight) => {
            const link = subjectLink(insight.subject_type, insight.subject_id);
            return (
              <Card key={insight.id} className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <ToneBadge
                        tone={SEVERITY_TONE[insight.severity]}
                        label={insight.severity}
                      />
                      <ToneBadge
                        tone={
                          insight.status === "OPEN"
                            ? "warning"
                            : insight.status === "RESOLVED"
                              ? "success"
                              : "neutral"
                        }
                        label={insight.status}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateTime(insight.generated_at)}
                      </span>
                    </div>
                    {link ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-foreground text-left hover:underline"
                        onClick={() => router.push(link)}
                      >
                        {insight.title}
                      </button>
                    ) : (
                      <p className="text-sm font-medium text-foreground">
                        {insight.title}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {insight.description}
                    </p>
                  </div>
                  {canManage &&
                    insight.status !== "DISMISSED" &&
                    insight.status !== "RESOLVED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActOn(insight)}
                      >
                        Act on this
                      </Button>
                    )}
                </div>
                {insight.evidence.length > 0 && (
                  <div className="flex flex-wrap gap-3 pt-1 border-t border-border/20">
                    {insight.evidence.map((e) => (
                      <div
                        key={e.id}
                        className="text-[11px] text-muted-foreground"
                      >
                        <span className="font-medium text-foreground">
                          {e.label}:
                        </span>{" "}
                        {e.detail}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {actOn && (
        <ActOnInsightDialog insight={actOn} onClose={() => setActOn(null)} />
      )}
    </div>
  );
}

function ActOnInsightDialog({
  insight,
  onClose,
}: {
  insight: InsightWithEvidence;
  onClose: () => void;
}) {
  const [outcomeType, setOutcomeType] =
    useState<InsightOutcomeType>("ACKNOWLEDGED");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: { value: InsightOutcomeType; label: string }[] = [
    { value: "ACKNOWLEDGED", label: "Acknowledge — I've seen this" },
    { value: "ACTED_ON", label: "Acted on it" },
    { value: "RESOLVED", label: "Resolved" },
    { value: "DISMISSED", label: "Dismiss" },
    { value: "FALSE_POSITIVE", label: "False positive" },
  ];

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await recordInsightOutcomeAction({
      insightId: insight.id,
      outcomeType,
      note,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not record outcome.");
      return;
    }
    toast.add({ title: "Outcome recorded" });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>Act on: {insight.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            {options.map((o) => (
              <label
                key={o.value}
                className="flex items-center gap-2 text-xs text-foreground cursor-pointer"
              >
                <input
                  type="radio"
                  name="outcome"
                  checked={outcomeType === o.value}
                  onChange={() => setOutcomeType(o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText> Note (optional)</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </InputGroup>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
