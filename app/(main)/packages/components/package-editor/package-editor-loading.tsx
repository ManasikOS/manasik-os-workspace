import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the package editor page is being prepared. Matches the screen's heading, stepper and first step. */
export default function PackageEditorLoading() {
  return (
    <div className="mx-auto flex w-full flex-col gap-6 pb-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Card className="gap-6">
        <div className="hidden items-start justify-between gap-2 md:flex">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex w-24 flex-col items-center gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-8 w-full md:hidden" />
        <div className="flex flex-col gap-4 border-t border-border/50 pt-6">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </Card>
    </div>
  );
}
