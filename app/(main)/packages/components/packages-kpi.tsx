"use client";

import React from "react";

import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";
import type { PackageListKpis } from "@/lib/types/packages";
import { BarChart, Book, LocationEdit, Paperclip, User } from "lucide-react";

export default function PackagesKpi({
  kpis,
  packageCount,
}: {
  kpis: PackageListKpis;
  packageCount: number;
}) {
  const occupancy =
    kpis.seatsCapacity > 0
      ? Math.round((kpis.seatsBooked / kpis.seatsCapacity) * 100)
      : 0;

  return (
    <KpiRow>
      <KpiCard
        title="Open for sale"
        icon={<Book className="size-4 text-muted-foreground" />}
        value={String(kpis.openForSale)}
        desc={`of ${packageCount} packages in view`}
      />
      <KpiCard
        title="Drafts in progress"
        icon={<BarChart className="size-4 text-muted-foreground" />}
        value={String(kpis.draftsInProgress)}
        desc="Not yet published"
      />
      <KpiCard
        title="Live departure groups"
        icon={<LocationEdit className="size-4 text-muted-foreground" />}
        value={String(kpis.liveGroups)}
        desc="Running from these packages"
      />
      <KpiCard
        icon={<User className="size-4 text-muted-foreground" />}
        title="Seats sold"
        value={`${kpis.seatsBooked} / ${kpis.seatsCapacity}`}
        desc={`${occupancy}% occupancy across live groups`}
      />
    </KpiRow>
  );
}
