import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the compact Finance overview while its role-safe snapshot loads. */
export default function FinanceWorkspaceLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
