"use client";

import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";
import type { VisaKpis, VisaQueue } from "../types";

interface VisaMetricsProps {
  kpis: VisaKpis;
  activeQueue: VisaQueue;
  onQueueChange: (queue: VisaQueue) => void;
  readOnly: boolean;
}

/** Five KPI cards, each a quick filter into the matching work-queue tab.
 *  CEO / Finance / Marketing get the same five as plain, non-clickable cards. */
const VisaMetrics = ({ kpis, activeQueue, onQueueChange, readOnly }: VisaMetricsProps) => {
  const cards: { title: string; value: number; desc: string; queue: VisaQueue }[] = [
    { title: "Ready to Submit", value: kpis.readyToSubmit, desc: "All required files verified", queue: "Ready to Submit" },
    { title: "Submitted / Pending", value: kpis.submittedPending, desc: "Awaiting decision or update", queue: "Submitted" },
    { title: "Visa Issues", value: kpis.visaIssues, desc: "Rejected, rework, mismatch, or blocked", queue: "Rework Required" },
    { title: "Issued", value: kpis.issued, desc: "Approved for active groups", queue: "Issued" },
    { title: "Groups at Visa Risk", value: kpis.groupsAtRisk, desc: "Departing soon with incomplete visas", queue: "By Group" },
  ];

  return (
    <KpiRow>
      {cards.map((card) =>
        readOnly ? (
          <KpiCard key={card.title} title={card.title} value={String(card.value)} desc={card.desc} />
        ) : (
          <button
            key={card.title}
            className="text-left"
            onClick={() => onQueueChange(activeQueue === card.queue ? "All Applications" : card.queue)}
          >
            <KpiCard title={card.title} value={String(card.value)} desc={card.desc} />
          </button>
        ),
      )}
    </KpiRow>
  );
};

export default VisaMetrics;
