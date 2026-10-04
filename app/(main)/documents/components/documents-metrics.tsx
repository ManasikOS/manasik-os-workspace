"use client";

import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";
import type { DocumentKpis } from "../types";
import type { DocumentQueue } from "../types";

interface DocumentsMetricsProps {
  kpis: DocumentKpis;
  activeQueue: DocumentQueue;
  onQueueChange: (queue: DocumentQueue) => void;
  readOnly: boolean;
}

/** Five KPI cards, each a quick filter into the matching work-queue tab.
 *  CEO gets the same five as plain, non-clickable cards. */
const DocumentsMetrics = ({
  kpis,
  activeQueue,
  onQueueChange,
  readOnly,
}: DocumentsMetricsProps) => {
  const cards: {
    title: string;
    value: number;
    desc: string;
    queue: DocumentQueue;
  }[] = [
    {
      title: "Missing Documents",
      value: kpis.missingDocuments,
      desc: `Across ${kpis.missingPilgrims} pilgrims`,
      queue: "Missing",
    },
    {
      title: "Awaiting Review",
      value: kpis.awaitingReview,
      desc: "Submitted by pilgrims or staff",
      queue: "Awaiting Review",
    },
    {
      title: "AI Flagged",
      value: kpis.aiFlagged,
      desc: "Quality, mismatch, expiry, or missing-page issues",
      queue: "AI Flagged",
    },
    {
      title: "Expiring Soon",
      value: kpis.expiringSoon,
      desc: "Passport or required document expiry risks",
      queue: "Expiring Soon",
    },
    {
      title: "Groups At Risk",
      value: kpis.groupsAtRisk,
      desc: "Document blockers affect departure readiness",
      queue: "By Group",
    },
  ];

  return (
    <KpiRow>
      {cards.map((card) =>
        readOnly ? (
          <KpiCard
            key={card.title}
            title={card.title}
            value={String(card.value)}
            desc={card.desc}
          />
        ) : (
          <button
            key={card.title}
            className="text-left"
            onClick={() =>
              onQueueChange(
                activeQueue === card.queue ? "All Documents" : card.queue,
              )
            }
          >
            <KpiCard
              title={card.title}
              value={String(card.value)}
              desc={card.desc}
            />
          </button>
        ),
      )}
    </KpiRow>
  );
};

export default DocumentsMetrics;
