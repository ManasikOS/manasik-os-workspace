"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, {
  useDeferredValue,
  useMemo,
  useState,
  useTransition,
} from "react";

import { DataTable } from "@/components/data-table/data-table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import { header } from "@/components/data-table/sortable-header";
import { ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";

import { supplierStatusTone } from "@/lib/data/operations";

import { autoAssignRoomsAction } from "../../actions";
import RoomingBoardPanel from "./rooming-board-panel";
import {
  operationsWorkspaceHref,
  type OperationsWorkspaceView,
} from "../../operations-workspace-navigation";
import { useOperations } from "../../operations-store";
import type { OperationsAccommodationItem } from "../../types";
import {
  SUPPLIER_STATUS_LABELS,
  daysRemainingLabel,
  formatDate,
} from "../../utils";

/**
 * Combines hotel confirmation and room allocation risk. The detailed rooming
 * board — assign a specific pilgrim to a specific room — stays on the
 * Departure Group's Hotels & Rooms tab; this is the cross-group summary.
 */
const AccommodationRoomingTab = ({
  view,
}: {
  view: OperationsWorkspaceView | null;
}) => {
  const router = useRouter();
  const { snapshot, can, roomingBoardRooms } = useOperations();
  const [isPending, startTransition] = useTransition();
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput);

  const filtered = useMemo(() => {
    if (!search.trim()) return snapshot.accommodations;
    const q = search.trim().toLowerCase();
    return snapshot.accommodations.filter(
      (a) =>
        a.groupName.toLowerCase().includes(q) ||
        a.hotelName.toLowerCase().includes(q) ||
        (a.supplierName ?? "").toLowerCase().includes(q),
    );
  }, [snapshot.accommodations, search]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => a.daysUntilDeparture - b.daysUntilDeparture),
    [filtered],
  );

  const autoAssign = (groupId: string, accommodationId: string) => {
    startTransition(async () => {
      const result = await autoAssignRoomsAction(groupId, accommodationId);
      if (!result.ok) {
        toast.add({
          title: "Could not auto-assign rooms",
          description: result.error,
        });
        return;
      }
      toast.add({ title: "Rooms auto-assigned" });
    });
  };

  const columns: ColumnDef<OperationsAccommodationItem>[] = [
    {
      id: "group",
      header: header("Group"),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            {row.original.groupName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {daysRemainingLabel(row.original.daysUntilDeparture)}
          </span>
        </div>
      ),
    },
    {
      id: "city",
      header: header("City"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {row.original.city.charAt(0) +
            row.original.city.slice(1).toLowerCase()}
        </span>
      ),
    },
    {
      id: "hotel",
      header: header("Hotel"),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">
            {row.original.hotelName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {row.original.supplierName ?? "No supplier recorded"}
          </span>
        </div>
      ),
    },
    {
      id: "dates",
      header: header("Check-in / Check-out"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground">
          {formatDate(row.original.checkInDate)} –{" "}
          {formatDate(row.original.checkOutDate)}
        </span>
      ),
    },
    {
      id: "rooms",
      header: header("Rooms Reserved"),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground tabular-nums">
            {row.original.roomsReserved}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {row.original.roomsAllocated} allocated · capacity{" "}
            {row.original.roomCapacity}
          </span>
        </div>
      ),
    },
    {
      id: "assigned",
      header: header("Pilgrims Assigned"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground tabular-nums">
          {row.original.pilgrimsAssigned} / {row.original.pilgrimCount}
        </span>
      ),
    },
    {
      id: "confirmation",
      header: header("Confirmation Status"),
      cell: ({ row }) => (
        <ToneBadge
          tone={supplierStatusTone(row.original.status)}
          label={
            SUPPLIER_STATUS_LABELS[row.original.status] ?? row.original.status
          }
        />
      ),
    },
    {
      id: "rooming",
      header: header("Rooming Status"),
      cell: ({ row }) => (
        <ToneBadge
          tone={row.original.roomingTone}
          label={row.original.roomingLabel}
        />
      ),
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div
            className="flex items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {can.manageRooming && (
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => autoAssign(item.groupId, item.id)}
              >
                Auto-Assign Rooms
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                router.push(`/departure-groups/${item.groupId}?tab=hotels`)
              }
            >
              Open Rooming Board
            </Button>
          </div>
        );
      },
      enableSorting: false,
    },
  ];

  const activeView = view ?? "stay-risks";

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={activeView}
        onValueChange={(next) =>
          router.replace(
            operationsWorkspaceHref(
              "accommodation",
              next === "rooming-board" ? "rooming-board" : null,
            ),
          )
        }
      >
        <TabsList>
          <TabsTrigger value="stay-risks">Stay risk queue</TabsTrigger>
          <TabsTrigger value="rooming-board">Rooming board</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "rooming-board" ? (
        roomingBoardRooms ? (
          <RoomingBoardPanel rooms={roomingBoardRooms} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Loading the rooming board…
          </p>
        )
      ) : (
        <DataTable
          columns={columns}
          data={sorted}
          search={search}
          onSearchChange={setSearchInput}
          searchPlaceholder="Search group, hotel, supplier…"
          resetPageToken={search}
          emptyMessage="No accommodation blocks on active groups."
        />
      )}
    </div>
  );
};

export default AccommodationRoomingTab;
