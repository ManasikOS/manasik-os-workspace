import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * `loading.tsx` skeleton for record pages (one pilgrim, group, supplier,
 * booking…): a header with title and actions, a tab strip, then a two-column
 * body of summary cards beside the main panel. The list-page shape in
 * `route-loading-skeleton.tsx` would jump visibly on these routes.
 */
export default function RouteDetailLoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-6 w-full max-w-[1600px] mx-auto pb-10"
      role="status"
      aria-label="Loading details"
    >
      <div className="flex items-end justify-between gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      <Skeleton className="h-10 w-full max-w-2xl" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="flex flex-col gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="gap-3 p-5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </Card>
          ))}
        </div>
        <Card className="lg:col-span-2 gap-4 p-5">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
      </div>
    </div>
  );
}
