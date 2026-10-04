"use client";

import { useSearchParams, usePathname } from "next/navigation";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { Calendar, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DASHBOARD_PERIODS, dashboardPeriodLabel, type DashboardPeriod } from "@/lib/data/dashboard";

/**
 * Drives L1 KPI deltas and (from Phase 3 onward) L3 trend charts only —
 * never L2, which is always live (§6). Narrower than Reports' own period
 * picker on purpose: no custom range, no comparison mode. `?period=` on the
 * URL so the choice survives a refresh and is visible in a shared link.
 */
export default function PeriodSelector({ period }: { period: DashboardPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectPeriod(next: DashboardPeriod) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Calendar className="size-3.5" />
            {dashboardPeriodLabel(period)}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {DASHBOARD_PERIODS.map((p) => (
          <DropdownMenuItem key={p} onClick={() => selectPeriod(p)}>
            {dashboardPeriodLabel(p)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
