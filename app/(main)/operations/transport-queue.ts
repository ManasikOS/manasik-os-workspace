import type { OperationsTransportItem } from "@/lib/types/operations";

/** Saved views for the Operations transport queue: every route, only routes with warnings, or one supplier status. */
export const TRANSPORT_QUEUE_VIEWS = [
  { id: "ALL", label: "All Routes" },
  { id: "NEEDS_ATTENTION", label: "Needs Attention" },
  { id: "REQUESTED", label: "Requested" },
  { id: "CONFIRMED", label: "Confirmed" },
  { id: "COMPLETED", label: "Completed" },
] as const;

export type TransportQueueViewId = (typeof TRANSPORT_QUEUE_VIEWS)[number]["id"];

export function filterTransportQueue(
  items: OperationsTransportItem[],
  { view, search }: { view: TransportQueueViewId; search: string },
): OperationsTransportItem[] {
  const needle = search.trim().toLowerCase();
  return items.filter((item) => {
    if (view === "NEEDS_ATTENTION" && item.warnings.length === 0) return false;
    if (view !== "ALL" && view !== "NEEDS_ATTENTION" && item.status !== view) return false;
    if (!needle) return true;
    return [item.groupName, item.routeLabel, item.supplierName ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}
