import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import React from "react";

interface KpiCardProps {
  title: string;
  value: string;
  desc?: React.ReactNode;
  icon?: React.ReactNode;
  /** Makes the tile a real toggle button — used for KPI-row quick filters. */
  onSelect?: () => void;
  /** Only meaningful together with `onSelect`. */
  selected?: boolean;
}

/** One stat tile. Shared shape across every module's KPI row. */
export function KpiCard({
  title,
  value,
  desc,
  icon,
  onSelect,
  selected,
}: KpiCardProps) {
  const card = (
    <Card className={cn("gap-0 h-full")}>
      <div className="flex gap-2 items-center">
        {icon && <div>{icon}</div>}
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
      </div>{" "}
      <p className="mt-2 text-4xl  tabular-nums font-semibold tracking-tight">
        {value}
      </p>
      {desc && (
        <div className="mt-3 text-xs text-muted-foreground font-normal">
          {desc}
        </div>
      )}
    </Card>
  );

  if (!onSelect) return card;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left w-full"
      aria-pressed={selected}
    >
      {card}
    </button>
  );
}

export function KpiRow({
  children,
  columns = 4,
}: {
  children: React.ReactNode;
  columns?: number;
}) {
  const desktopColumns =
    columns === 3
      ? "lg:grid-cols-3"
      : columns === 4
        ? "lg:grid-cols-4"
        : "lg:grid-cols-2";

  return (
    <div
      className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", desktopColumns)}
    >
      {children}
    </div>
  );
}
