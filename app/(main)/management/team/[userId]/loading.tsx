import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function TeamMemberLoading() {
  return (
    <div className="flex flex-col gap-6 w-full mx-auto pb-10">
      <div className="flex items-end justify-between gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="flex gap-2">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-28" />
      </div>

      <Skeleton className="h-10 w-full max-w-lg" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-12" />
          </Card>
        ))}
      </div>
    </div>
  );
}
