import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function TeamLoading() {
  return (
    <div className="flex flex-col gap-6 w-full mx-auto pb-10">
      <div className="flex items-end justify-between gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-16" />
            <Skeleton className="h-3 w-32" />
          </Card>
        ))}
      </div>

      <Skeleton className="h-10 w-full max-w-md" />

      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b border-border/40">
          <Skeleton className="h-9 w-full max-w-md" />
        </div>
        <div className="divide-y divide-border/20">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-5">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
