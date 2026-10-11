import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the Add Lead page is being prepared. Matches the screen's heading, stepper and first step. */
export default function LeadEditorLoading() {
  return (
    <div className="mx-auto flex w-full flex-col gap-4 pb-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Card className="@container gap-4 py-4">
        <div className="hidden items-start justify-between gap-2 @3xl:flex">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex w-24 flex-col items-center gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-8 w-full @3xl:hidden" />
        <div className="flex flex-col gap-1 border-t border-border/50 pt-4">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </Card>
      <Card className="max-w-3xl gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </Card>
    </div>
  );
}
