import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <Card className="flex flex-col gap-4 p-6">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="flex flex-col gap-3 mt-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </Card>
  );
}
