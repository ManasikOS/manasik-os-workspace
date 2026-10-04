"use client";

import {
  ArrowUp,
  ArrowDown,
  MessageSquarePlus,
  ContactRound,
  PlaneTakeoff,
  Wallet,
  HandCoins,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import React from "react";
import { AdminKpi } from "@/lib/types/dashboard";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TONE_CLASS, TONE_TEXT, type Tone } from "@/lib/ui/tone";
import { KpiCard } from "@/components/data-table/kpi-card";

interface DashboardMetricsProps {
  kpis: AdminKpi[];
}

/**
 * Each KPI's category icon + tone — purely categorical (what kind of
 * number this is), never a stand-in for a real trend. `AdminKpi` carries no
 * historical series (see lib/types/dashboard.ts), so the tile never renders
 * a sparkline it would have to invent one for — the icon badge is the
 * closest thing to the reference dashboards' inline mini-charts that this
 * data actually supports.
 */
const KPI_PRESENTATION: Record<string, { icon: LucideIcon; tone: Tone }> = {
  "new-inquiries": { icon: MessageSquarePlus, tone: "info" },
  "active-pilgrims": { icon: ContactRound, tone: "brand" },
  "departing-30": { icon: PlaneTakeoff, tone: "info" },
  "collections-period": { icon: Wallet, tone: "success" },
  "outstanding-balance": { icon: HandCoins, tone: "warning" },
  "group-readiness": { icon: ClipboardCheck, tone: "success" },
};

export default function DashboardMetrics({ kpis }: DashboardMetricsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi, index) => {
        const presentation = KPI_PRESENTATION[kpi.id] ?? {
          icon: ClipboardCheck,
          tone: "neutral" as Tone,
        };
        const Icon = presentation.icon;
        return (
          <Link
            key={kpi.id}
            href={kpi.destination}
            className="block group outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-backwards"
            style={{
              animationDelay: `${index * 40}ms`,
              animationDuration: "400ms",
            }}
          >
            <KpiCard
              title={kpi.title}
              icon={
                <Icon
                  className={cn("size-4.5", TONE_TEXT[presentation.tone])}
                />
              }
              desc={
                kpi.trend && (
                  <div
                    className={cn(
                      "flex gap-1 items-center text-xs font-medium px-2 py-0.5 rounded-full",
                      TONE_CLASS[
                        kpi.trendType === "positive"
                          ? "success"
                          : kpi.trendType === "negative"
                            ? "danger"
                            : "neutral"
                      ],
                    )}
                  >
                    {kpi.trendType === "positive" ? (
                      <ArrowUp className="size-3 shrink-0" />
                    ) : kpi.trendType === "negative" ? (
                      <ArrowDown className="size-3 shrink-0" />
                    ) : null}
                    <span>{kpi.trend}</span>
                  </div>
                )
              }
              value={kpi.value}
            />
          </Link>
        );
      })}
    </div>
  );
}
