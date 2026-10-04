import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PackageDetailLoading() {
  return (
    <div className="flex flex-col gap-6 w-full mx-auto pb-10">
      <div className="flex items-end justify-between gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="h-9 w-full max-w-2xl" />
      <Card className="p-6">
        <Skeleton className="h-64 w-full" />
      </Card>
    </div>
  );
}
