import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the package editor page is being prepared. Matches the screen's heading, stepper and first step. */
export default function PackageEditorLoading() {
  return (
    <div className="mx-auto flex w-full flex-col gap-4 pb-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Card className="@container gap-4 py-4">
        <div className="hidden items-start justify-between gap-2 @3xl:flex">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex w-24 flex-col items-center gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-8 w-full @3xl:hidden" />
        <div className="flex flex-col gap-1 border-t border-border/50 pt-4">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </Card>
      <Card className="gap-4">
        <Skeleton className="h-5 w-48" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Card>
    </div>
  );
}
