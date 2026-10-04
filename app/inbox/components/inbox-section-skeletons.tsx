import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows shown while the chat list loads — the first part of the Inbox to arrive. */
export function ConversationListSkeleton() {
  return (
    <div
      className="flex h-full flex-col gap-4 p-4"
      role="status"
      aria-label="Loading conversations"
    >
      <div className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-9 w-full" />
      <div className="flex flex-col gap-5 pt-1">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-11 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Placeholder for the messages and reply box while the open conversation loads. */
export function ConversationThreadSkeleton() {
  return (
    <>
      <div
        className="flex flex-1 flex-col justify-end gap-3 bg-muted/[0.14] px-5 py-5"
        role="status"
        aria-label="Loading messages"
      >
        <Skeleton className="h-12 w-2/5 rounded-2xl" />
        <Skeleton className="h-12 w-1/3 self-end rounded-2xl" />
        <Skeleton className="h-16 w-1/2 rounded-2xl" />
        <Skeleton className="h-10 w-2/5 self-end rounded-2xl" />
      </div>
      <div className="border-t p-4">
        <Skeleton className="h-10 w-full rounded-full" />
      </div>
    </>
  );
}

/** Placeholder for the lead panel, which loads last. */
export function LeadContextSkeleton() {
  return (
    <div
      className="h-full space-y-5 p-4"
      role="status"
      aria-label="Loading customer details"
    >
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
