import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the package editor page is being prepared. Matches the screen's heading and card. */
export default function PackageEditorLoading() {
  return (
    <div className="mx-auto flex w-full flex-col gap-4 pb-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Card className="h-[calc(100dvh-13rem)] min-h-[32rem] flex-row gap-0 overflow-hidden p-0">
        <div className="hidden w-70 shrink-0 flex-col gap-3 border-r border-border/50 p-4 md:flex">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-4 p-5">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </Card>
    </div>
  );
}
