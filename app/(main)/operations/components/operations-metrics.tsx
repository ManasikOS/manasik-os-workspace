"use client";

import { KpiCard } from "@/components/data-table/kpi-card";

import type { OperationsKpis } from "../types";
import {
  AlertTriangle,
  ListCheck,
  ListOrdered,
  PlaneTakeoff,
  Truck,
  User,
  Users,
} from "lucide-react";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface OperationsMetricsProps {
  kpis: OperationsKpis;
  readOnly: boolean;
  onOpen: (
    tab: "overview" | "readiness" | "suppliers" | "tasks",
    filter?: string,
  ) => void;
}

/** Six KPI cards, each a quick jump into the tab that owns the number. */
const OperationsMetrics = ({
  kpis,
  readOnly,
  onOpen,
}: OperationsMetricsProps) => {
  const cards: {
    title: string;
    value: string;
    desc: string;
    tab: "overview" | "readiness" | "suppliers" | "tasks";
    filter?: string;
    icon: React.ReactNode;
  }[] = [
    {
      title: "Upcoming Departures",
      value: String(kpis.upcomingDepartures),
      desc: "Next 30 days",
      tab: "overview",
      icon: <PlaneTakeoff className="size-4 text-muted-foreground" />,
    },
    {
      title: "Groups At Risk",
      value: String(kpis.groupsAtRisk),
      desc: "Critical blockers found",
      tab: "readiness",
      icon: <AlertTriangle className={cn("size-4", TONE_TEXT.danger)} />,
    },
    {
      title: "Supplier Confirmations Pending",
      value: String(kpis.supplierConfirmationsPending),
      desc: "Hotels, flights, transport, catering",
      tab: "suppliers",
      icon: <Truck className="size-4 text-muted-foreground" />,
    },
    {
      title: "Tasks Due Today",
      value: String(kpis.tasksDueToday),
      desc: "Across Operations and Guides",
      tab: "tasks",
      filter: "Due Today",
      icon: <ListCheck className="size-4 text-muted-foreground" />,
    },
    {
      title: "Unassigned Operations Work",
      value: String(kpis.unassignedWork),
      desc: "Needs an owner",
      tab: "tasks",
      filter: "Unassigned",
      icon: <User className="size-4 text-muted-foreground" />,
    },
    {
      title: "Group Readiness Average",
      value: `${kpis.readinessAverage}%`,
      desc: "Across active groups",
      tab: "readiness",
      icon: <Users className="size-4 text-muted-foreground" />,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-5">
      {cards.map((card) =>
        readOnly ? (
          <KpiCard
            key={card.title}
            title={card.title}
            value={card.value}
            desc={card.desc}
            icon={card.icon}
          />
        ) : (
          <button
            key={card.title}
            className="text-left"
            onClick={() => onOpen(card.tab, card.filter)}
          >
            <KpiCard
              title={card.title}
              value={card.value}
              desc={card.desc}
              icon={card.icon}
            />
          </button>
        ),
      )}
    </div>
  );
};

export default OperationsMetrics;
