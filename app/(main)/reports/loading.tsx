import { Skeleton } from "@/components/ui/skeleton";
import { KpiRow } from "@/components/data-table/kpi-card";

export default function ReportsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-32" />
        ))}
      </div>

      <KpiRow>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-md" />
        ))}
      </KpiRow>

      <Skeleton className="h-96 w-full rounded-md" />
    </div>
  );
}
