"use client";

import React from "react";

import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";
import type { DepartureGroupListKpis } from "../../types";
import { AlertTriangle, PlaneTakeoff, User, Users } from "lucide-react";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface DepartureGroupsKPIProps {
  kpis: DepartureGroupListKpis;
  /** Total in view, used for the "of N groups" captions. */
  groupCount: number;
}

const DepartureGroupsKPI = ({ kpis, groupCount }: DepartureGroupsKPIProps) => {
  const cards = [
    {
      title: "Upcoming departures",
      value: String(kpis.upcomingDepartures),
      desc: `of ${groupCount} groups in view`,
      icon: <PlaneTakeoff className="size-4 text-muted-foreground" />,
    },
    {
      title: "At-risk groups",
      value: String(kpis.atRiskGroups),
      desc:
        kpis.atRiskGroups > 0
          ? "Readiness at risk or blocked"
          : "All groups on track",
      icon: <AlertTriangle className={cn("size-4", TONE_TEXT.warning)} />,
    },
    {
      title: "Seats available",
      value: String(kpis.seatsAvailable),
      desc: "Across groups open for sale",
      icon: <User className="size-4 text-muted-foreground" />,
    },
    {
      title: "Groups preparing",
      value: String(kpis.groupsPreparing),
      desc: "Operational status: Preparing",
      icon: <Users className="size-4 text-muted-foreground" />,
    },
    // {
    //   title: "Departing in 14 days",
    //   value: String(kpis.departingInFourteenDays),
    //   desc: "Needs final checks",
    // },
  ];

  return (
    <KpiRow>
      {cards.map((card) => (
        <KpiCard
          key={card.title}
          title={card.title}
          value={card.value}
          icon={card.icon}
          desc={card.desc}
        />
      ))}
    </KpiRow>
  );
};

export default DepartureGroupsKPI;
