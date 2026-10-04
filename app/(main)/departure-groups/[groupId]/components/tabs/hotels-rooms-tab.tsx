"use client";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import {
  capabilitiesFor,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import {
  AlertTriangle,
  BedDouble,
  Building2,
  CheckCircle2,
  Download,
  FileText,
  Hash,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Upload,
  UserPlus,
} from "lucide-react";
import React, { useState, useTransition } from "react";

import {
  DeviationStatusBadge,
  EmptyState,
  ProgressBar,
  RoomStatusBadge,
  SupplierStatusBadge,
} from "../../../components/status-badges";
import { downloadTextFile, timestampedFilename, toCsv } from "../../../csv";
import type {
  DepartureGroupAccommodation,
  DepartureGroupManifestRow,
  DepartureGroupRoom,
  PilgrimDeviation,
} from "../../../types";
import {
  ROOM_STATUS_LABELS,
  ROOM_TYPE_LABELS,
  formatDate,
  formatExactCurrency,
} from "../../../utils";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import { markAccommodationConfirmedAction } from "../../../actions";
import AccommodationReferenceDialog from "../accommodation-reference-dialog";
import AccommodationVoucherDialog from "../accommodation-voucher-dialog";
import AssignRoomDialog from "../assign-room-dialog";
import AutoAssignRoomsDialog from "../auto-assign-rooms-dialog";
import EditAccommodationSheet from "../edit-accommodation-dialog";
import EditRoomDialog from "../edit-room-dialog";
import GenerateRoomsDialog from "../generate-rooms-dialog";

interface HotelsRoomsTabProps {
  groupId: string;
  /** Names the exported rooming list, so files are traceable to a group. */
  groupCode: string;
  accommodations: DepartureGroupAccommodation[];
  manifest: DepartureGroupManifestRow[];
  role: StaffRole;
}

const CITY_LABELS: Record<string, string> = {
  MAKKAH: "Makkah",
  MADINAH: "Madinah",
  MINA: "Mina",
  ARAFAT: "Arafat",
  OTHER: "Other",
};

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-sm text-foreground ${mono ? "font-number" : ""}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * A rooming list is only useful if it names who is in each room, so the
 * occupants are joined in from the manifest rather than exporting bed counts
 * alone. Pilgrims with no room yet are listed at the end — they are exactly the
 * rows the person holding this sheet has to resolve.
 */
function exportRoomingList(
  accommodations: DepartureGroupAccommodation[],
  manifest: DepartureGroupManifestRow[],
  groupCode: string,
): void {
  // Built from `roomAssignments`, not the `roomId` rollup — a pilgrim can
  // hold a room in every accommodation at once, and the rollup only names
  // the most recently touched one.
  const occupantsByRoom = new Map<string, string[]>();
  for (const row of manifest) {
    for (const a of row.roomAssignments) {
      const names = occupantsByRoom.get(a.roomId);
      if (names) names.push(row.fullName);
      else occupantsByRoom.set(a.roomId, [row.fullName]);
    }
  }

  const rows: string[][] = [
    [
      "City",
      "Hotel",
      "Room Number",
      "Room Type",
      "Capacity",
      "Assigned",
      "Status",
      "Occupants",
    ],
    ...accommodations.flatMap((accommodation) =>
      accommodation.rooms.map((room) => [
        CITY_LABELS[accommodation.city] ?? accommodation.city,
        accommodation.hotelName,
        room.roomNumber ?? "—",
        ROOM_TYPE_LABELS[room.roomType],
        String(room.occupancyCapacity),
        String(room.assignedPilgrimCount),
        ROOM_STATUS_LABELS[room.status],
        (occupantsByRoom.get(room.id) ?? []).join("; "),
      ]),
    ),
  ];

  // Reported per accommodation — a pilgrim missing only their Madinah room
  // is still "unassigned" there even though they already have a Makkah bed.
  for (const accommodation of accommodations) {
    const unassigned = manifest.filter(
      (row) => !row.roomAssignments.some((a) => a.accommodationId === accommodation.id),
    );
    if (unassigned.length === 0) continue;
    rows.push(
      [],
      [
        `Unassigned pilgrims — ${CITY_LABELS[accommodation.city] ?? accommodation.city}`,
        "Booking",
      ],
    );
    for (const row of unassigned) {
      rows.push([row.fullName, row.bookingReference]);
    }
  }

  downloadTextFile(
    timestampedFilename(`${groupCode}-rooming-list`),
    toCsv(rows),
  );
}

const HotelsRoomsTab = ({
  groupId,
  groupCode,
  accommodations,
  manifest,
  role,
}: HotelsRoomsTabProps) => {
  const can = capabilitiesFor(role);
  const [isConfirming, startConfirming] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const rooms = accommodations.flatMap((accommodation) => accommodation.rooms);

  const [editAccommodation, setEditAccommodation] =
    useState<DepartureGroupAccommodation | null>(null);
  const [addAccommodationOpen, setAddAccommodationOpen] = useState(false);
  const [voucherAccommodation, setVoucherAccommodation] =
    useState<DepartureGroupAccommodation | null>(null);
  const [referenceAccommodation, setReferenceAccommodation] =
    useState<DepartureGroupAccommodation | null>(null);
  const [generateRoomsAccommodation, setGenerateRoomsAccommodation] =
    useState<DepartureGroupAccommodation | null>(null);
  const [editRoom, setEditRoom] = useState<DepartureGroupRoom | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);
  const [roomsTabId, setRoomsTabId] = useState(accommodations[0]?.id ?? "");

  // Falls back to the first hotel if the remembered tab id no longer matches
  // one (e.g. after a group's accommodation blocks change).
  const activeAccommodation =
    accommodations.find((a) => a.id === roomsTabId) ??
    accommodations[0] ??
    null;
  const activeRooms = activeAccommodation?.rooms ?? [];
  // Scoped to the active hotel, not the whole group — a pilgrim can hold a
  // room in Makkah and a separate one in Madinah at once, so a group-wide
  // count would double-count them and hide who still needs a room here.
  const assignedHere = manifest.filter((row) =>
    row.roomAssignments.some((a) => a.accommodationId === activeAccommodation?.id),
  ).length;

  const markConfirmed = (accommodation: DepartureGroupAccommodation) => {
    setConfirmingId(accommodation.id);
    startConfirming(async () => {
      const result = await markAccommodationConfirmedAction({
        id: accommodation.id,
        departureGroupId: groupId,
      });
      setConfirmingId(null);

      if (!result.ok) {
        toast.add({
          title: "Could not confirm accommodation",
          description: result.error,
        });
        return;
      }

      toast.add({
        title: "Accommodation confirmed",
        description: result.hotelName,
      });
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <EditAccommodationSheet
        accommodation={editAccommodation}
        departureGroupId={groupId}
        role={role}
        open={editAccommodation !== null}
        setOpen={(open) => {
          if (!open) setEditAccommodation(null);
        }}
      />
      <EditAccommodationSheet
        accommodation={null}
        departureGroupId={groupId}
        role={role}
        open={addAccommodationOpen}
        setOpen={setAddAccommodationOpen}
      />
      <AccommodationVoucherDialog
        accommodation={voucherAccommodation}
        departureGroupId={groupId}
        open={voucherAccommodation !== null}
        onClose={() => setVoucherAccommodation(null)}
      />
      <AccommodationReferenceDialog
        accommodation={referenceAccommodation}
        departureGroupId={groupId}
        open={referenceAccommodation !== null}
        onClose={() => setReferenceAccommodation(null)}
      />
      <GenerateRoomsDialog
        accommodation={generateRoomsAccommodation}
        departureGroupId={groupId}
        open={generateRoomsAccommodation !== null}
        onClose={() => setGenerateRoomsAccommodation(null)}
      />
      <EditRoomDialog
        room={editRoom}
        departureGroupId={groupId}
        open={editRoom !== null}
        onClose={() => setEditRoom(null)}
      />
      <AssignRoomDialog
        accommodations={accommodations}
        manifest={manifest}
        role={role}
        departureGroupId={groupId}
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
      />
      <AutoAssignRoomsDialog
        accommodation={activeAccommodation}
        manifest={manifest}
        departureGroupId={groupId}
        open={autoAssignOpen}
        onClose={() => setAutoAssignOpen(false)}
      />

      <SectionHeading
        title="Accommodation"
        act={
          can.manageAccommodation && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAddAccommodationOpen(true)}
            >
              <Plus /> Add Hotel
            </Button>
          )
        }
      />

      {accommodations.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="size-6" />}
            title="No accommodation blocks yet"
            description="Copied from the Package Template if requested at creation, or add one manually here."
            action={
              can.manageAccommodation && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAddAccommodationOpen(true)}
                >
                  <Plus /> Add Hotel
                </Button>
              )
            }
          />
        </Card>
      ) : (
        accommodations.map((accommodation) => (
          <Card key={accommodation.id} className="gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Building2 className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {CITY_LABELS[accommodation.city]} Accommodation
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {accommodation.hotelName || "Hotel not yet selected"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SupplierStatusBadge value={accommodation.status} />
                {can.manageAccommodation && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditAccommodation(accommodation);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setVoucherAccommodation(accommodation)}
                    >
                      <Upload /> Voucher
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setReferenceAccommodation(accommodation)}
                    >
                      <Hash /> Reference
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setGenerateRoomsAccommodation(accommodation)}
                    >
                      <Plus /> Generate Rooms
                    </Button>
                    {accommodation.status !== "CONFIRMED" &&
                      accommodation.status !== "CANCELLED" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={
                            isConfirming && confirmingId === accommodation.id
                          }
                          onClick={() => markConfirmed(accommodation)}
                        >
                          {isConfirming && confirmingId === accommodation.id ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <CheckCircle2 />
                          )}
                          Mark Confirmed
                        </Button>
                      )}
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Detail
                label="Supplier / broker"
                value={accommodation.supplierName ?? "Not assigned"}
              />
              <Detail
                label="Booking reference"
                value={accommodation.bookingReference ?? "—"}
                mono
              />
              <Detail
                label="Check-in / out"
                value={`${formatDate(accommodation.checkInDate)} – ${formatDate(
                  accommodation.checkOutDate,
                )}`}
              />
              <Detail label="Nights" value={accommodation.nights} mono />
              <Detail
                label="Rooms reserved"
                value={accommodation.roomsReserved}
                mono
              />
              <Detail
                label="Rooms allocated"
                value={`${accommodation.roomsAllocated} / ${accommodation.roomsReserved}`}
                mono
              />
              <Detail label="Meal plan" value={accommodation.mealPlan ?? "—"} />
              <Detail
                label="Distance"
                value={accommodation.distanceDescription ?? "—"}
              />
              {/* Supplier cost is nulled server-side for roles without access,
                  so this simply has nothing to render for them. */}
              {accommodation.internalCost !== null && (
                <Detail
                  label="Internal cost"
                  value={formatExactCurrency(accommodation.internalCost)}
                  mono
                />
              )}
              <Detail
                label="Voucher"
                value={
                  accommodation.voucherUrl ? (
                    <a
                      href={accommodation.voucherUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <FileText className="size-3.5" /> View voucher
                    </a>
                  ) : (
                    "Not uploaded"
                  )
                }
              />
            </div>

            {accommodation.notes && (
              <p className={cn("text-xs rounded-sm px-3 py-2", TONE_CLASS.warning)}>
                {accommodation.notes}
              </p>
            )}
          </Card>
        ))
      )}

      {/* Rooming allocation */}
      <Card className="gap-4">
        <SectionHeading
          title="Rooming allocation"
          act={
            <div className="flex flex-wrap items-center gap-2">
              {can.manageRooming && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAutoAssignOpen(true)}
                >
                  <Sparkles /> Auto Assign Rooms
                  {activeAccommodation
                    ? ` — ${CITY_LABELS[activeAccommodation.city] ?? activeAccommodation.city}`
                    : ""}
                </Button>
              )}
              {can.manageRooming && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAssignOpen(true)}
                >
                  <UserPlus /> Assign Manually
                </Button>
              )}
              {can.exportReports && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={rooms.length === 0}
                  onClick={() =>
                    exportRoomingList(accommodations, manifest, groupCode)
                  }
                >
                  <Download /> Export Rooming List
                </Button>
              )}
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col gap-1 min-w-48">
            <span className="text-xs text-muted-foreground">
              <strong className="font-number text-foreground">
                {assignedHere}
              </strong>{" "}
              of {manifest.length} pilgrims assigned in{" "}
              {activeAccommodation
                ? (CITY_LABELS[activeAccommodation.city] ?? activeAccommodation.city)
                : "this hotel"}
            </span>
            <ProgressBar
              percent={
                manifest.length === 0
                  ? 0
                  : Math.round((assignedHere / manifest.length) * 100)
              }
            />
          </div>
          <span className="text-xs text-muted-foreground">
            <strong className="font-number text-foreground">
              {rooms.length}
            </strong>{" "}
            rooms across {accommodations.length} hotel
            {accommodations.length === 1 ? "" : "s"}
          </span>
        </div>

        {accommodations.length === 0 ? (
          <EmptyState
            icon={<BedDouble className="size-6" />}
            title="No rooms created yet"
            description="Copy an accommodation block above, then use Generate Rooms to create its room inventory."
          />
        ) : (
          <>
            <Tabs
              value={activeAccommodation?.id ?? ""}
              onValueChange={(next) => setRoomsTabId(next)}
            >
              <TabsList className="flex-wrap h-auto">
                {accommodations.map((accommodation) => (
                  <TabsTrigger key={accommodation.id} value={accommodation.id}>
                    {CITY_LABELS[accommodation.city] ?? accommodation.city}
                    <span className="ml-1.5 text-muted-foreground font-number">
                      ({accommodation.rooms.length})
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {activeRooms.length === 0 ? (
              <EmptyState
                icon={<BedDouble className="size-6" />}
                title="No rooms created yet for this hotel"
                description={`Use Generate Rooms on the ${
                  activeAccommodation
                    ? CITY_LABELS[activeAccommodation.city] ??
                      activeAccommodation.city
                    : ""
                } accommodation block above to create its room inventory.`}
              />
            ) : (
              <div className="overflow-x-auto no-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-none!">
                      {[
                        "Room number",
                        "Room type",
                        "Capacity",
                        "Pilgrims assigned",
                        "Status",
                        "",
                      ].map((label) => (
                        <TableHead
                          key={label}
                          className="h-10 px-3 text-xs font-medium text-muted-foreground"
                        >
                          {label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-border/20">
                    {activeRooms.map((room) => (
                      <TableRow key={room.id} className="hover:bg-muted/50">
                        <TableCell className="px-3 py-2.5 text-sm font-number text-foreground">
                          {room.roomNumber ?? "—"}
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-xs text-foreground">
                          {ROOM_TYPE_LABELS[room.roomType]}
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-xs font-number text-foreground">
                          {room.occupancyCapacity}
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-xs font-number text-foreground">
                          {room.assignedPilgrimCount} / {room.occupancyCapacity}
                          {room.status === "PARTIAL" && (
                            <span className="ml-2 text-muted-foreground font-sans">
                              {room.occupancyCapacity -
                                room.assignedPilgrimCount}{" "}
                              bed
                              {room.occupancyCapacity -
                                room.assignedPilgrimCount ===
                              1
                                ? ""
                                : "s"}{" "}
                              available
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2.5">
                          <RoomStatusBadge value={room.status} />
                        </TableCell>
                        <TableCell className="px-3 py-2.5 text-right">
                          {can.manageAccommodation && (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setEditRoom(room)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Accommodation deviations */}
      {(() => {
        const ACCOM_DEV_TYPES = new Set([
          "ROOM_TYPE",
          "EXTRA_NIGHTS",
          "HOTEL_UPGRADE",
          "MEAL_PLAN",
          "ROOMMATE_REQUEST",
          "EXTENDED_STAY",
        ]);
        const accomDevs: {
          pilgrimName: string;
          deviation: PilgrimDeviation;
        }[] = [];
        for (const row of manifest) {
          for (const d of row.deviations) {
            if (
              ACCOM_DEV_TYPES.has(d.deviationType) &&
              d.status !== "DECLINED" &&
              d.status !== "CANCELLED"
            ) {
              accomDevs.push({ pilgrimName: row.fullName, deviation: d });
            }
          }
        }

        if (accomDevs.length === 0) return null;

        return (
          <Card className="gap-4">
            <SectionHeading
              title="Accommodation deviations"
              act={
                <span className="text-xs text-muted-foreground">
                  {accomDevs.length} deviation
                  {accomDevs.length === 1 ? "" : "s"}
                </span>
              }
            />
            <div className="flex flex-col divide-y divide-border/20">
              {accomDevs.map(({ pilgrimName, deviation }) => (
                <div
                  key={deviation.id}
                  className="flex items-start justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{pilgrimName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {deviation.deviationType.replace(/_/g, " ")} —{" "}
                      {deviation.summary}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {deviation.blocksDeparture && (
                      <AlertTriangle className={cn("size-3.5", TONE_TEXT.warning)} />
                    )}
                    <DeviationStatusBadge
                      value={deviation.status}
                      className="text-[10px] px-2 py-1"
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}
    </div>
  );
};

export default HotelsRoomsTab;
