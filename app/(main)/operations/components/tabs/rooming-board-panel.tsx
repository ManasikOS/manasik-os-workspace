"use client";

import { useMemo, useState } from "react";
import { BedDouble } from "lucide-react";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import SearchInput from "@/components/ui/search-input";
import { ToneBadge } from "@/components/ui/tone-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import { EmptyState } from "@/app/(main)/departure-groups/components/status-badges";
import { formatDate } from "@/app/(main)/departure-groups/utils";
import type {
  AccommodationCity,
  CrossGroupRoomRow,
  RoomStatus,
} from "@/lib/data/hotels-repository";
import type { Tone } from "@/lib/ui/tone";

import {
  clusterRoomsByHotelStay,
  filterRoomingClusters,
  summariseRoomingBoard,
  type RoomingBoardMode,
} from "../../rooming-board";

const CITY_LABELS: Record<AccommodationCity, string> = {
  MAKKAH: "Makkah",
  MADINAH: "Madinah",
  MINA: "Mina",
  ARAFAT: "Arafat",
  OTHER: "Other",
};

const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  AVAILABLE: "Available",
  PARTIAL: "Partial",
  COMPLETE: "Complete",
  BLOCKED: "Blocked",
};

const ROOM_STATUS_TONE: Record<RoomStatus, Tone> = {
  AVAILABLE: "neutral",
  PARTIAL: "warning",
  COMPLETE: "success",
  BLOCKED: "danger",
};

const MODE_LABELS: Record<RoomingBoardMode, string> = {
  PARTIAL: "Partial rooms",
  MULTI_GROUP: "Shared hotel (2+ groups)",
  ALL: "All",
};

/**
 * Every room across every group's hotel stay, clustered by hotel and dates so
 * partially filled rooms in different groups can be spotted and consolidated.
 * Read-only: moving pilgrims between rooms is a per-group action on that
 * group's own Hotels tab, which each row links to.
 */
export default function RoomingBoardPanel({
  rooms,
}: {
  rooms: CrossGroupRoomRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<RoomingBoardMode>("PARTIAL");

  const clusters = useMemo(() => clusterRoomsByHotelStay(rooms), [rooms]);
  const visibleClusters = useMemo(
    () => filterRoomingClusters(clusters, { search, mode }),
    [clusters, search, mode],
  );
  const summary = useMemo(() => summariseRoomingBoard(rooms), [rooms]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard title="Rooms" value={String(summary.rooms)} />
        <KpiCard title="Partial rooms" value={String(summary.partialRooms)} />
        <KpiCard title="Occupancy" value={`${summary.occupancyPercent}%`} />
        <KpiCard title="Hotel clusters" value={String(summary.clusters)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search hotel…"
        />
        <div className="flex flex-wrap gap-1.5">
          {(["PARTIAL", "MULTI_GROUP", "ALL"] as const).map((key) => (
            <Badge
              key={key}
              variant={mode === key ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() => setMode(key)}
            >
              {MODE_LABELS[key]}
            </Badge>
          ))}
        </div>
      </div>

      {visibleClusters.length === 0 ? (
        <EmptyState
          icon={<BedDouble className="size-8" />}
          title="Nothing to show"
          description="Try a different filter or search."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {visibleClusters.map((cluster) => (
            <Card
              key={cluster.key}
              className="p-0 overflow-x-auto no-scrollbar"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {cluster.hotelName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {CITY_LABELS[cluster.city]} ·{" "}
                    {formatDate(cluster.checkInDate)} –{" "}
                    {formatDate(cluster.checkOutDate)}
                    {cluster.groupCount > 1 &&
                      ` · ${cluster.groupCount} groups`}
                  </p>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {[
                      "Group",
                      "Room",
                      "Type",
                      "Occupancy",
                      "Status",
                      "Notes",
                    ].map((label) => (
                      <TableHead
                        key={label}
                        className="h-9 px-3 text-xs font-medium text-muted-foreground"
                      >
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {cluster.rooms.map((room) => (
                    <TableRow
                      key={room.id}
                      className="hover:bg-muted/40 cursor-pointer"
                      onClick={() =>
                        router.push(
                          `/departure-groups/${room.departureGroupId}?tab=hotels`,
                        )
                      }
                    >
                      <TableCell className="px-3 py-3 text-xs text-foreground">
                        {room.groupName}{" "}
                        <span className="text-muted-foreground">
                          · {room.groupCode}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                        {room.roomNumber ?? "—"}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-foreground">
                        {room.roomType}
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs tabular-nums text-foreground">
                        {room.assignedPilgrimCount} / {room.occupancyCapacity}
                      </TableCell>
                      <TableCell className="px-3 py-3">
                        <ToneBadge
                          tone={ROOM_STATUS_TONE[room.status]}
                          label={ROOM_STATUS_LABELS[room.status]}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                        {room.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
