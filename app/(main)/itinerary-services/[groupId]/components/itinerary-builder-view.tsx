"use client";

import { useEffect, useState, useTransition } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroupField } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ToneBadge } from "@/components/ui/tone-badge";
import { Plus, Trash2, UploadCloud } from "lucide-react";

import { formatDate } from "@/app/(main)/departure-groups/utils";
import type { Tone } from "@/lib/ui/tone";
import type {
  AttendanceStatus,
  AttendanceWithPilgrim,
  ItineraryCity,
  ItineraryDayRow,
  ItineraryEventRow,
  ItineraryEventType,
  ItineraryRow,
  VoucherWithPilgrim,
} from "@/lib/data/itinerary-repository";

import {
  addItineraryDayAction,
  addItineraryEventAction,
  getEventAttendanceAction,
  getEventVouchersAction,
  issueVoucherAction,
  publishItineraryAction,
  removeItineraryDayAction,
  removeItineraryEventAction,
  setAttendanceAction,
  toggleEventConfirmedAction,
  updateVoucherStatusAction,
} from "../../actions";

const CITY_LABELS: Record<ItineraryCity, string> = {
  MAKKAH: "Makkah",
  MADINAH: "Madinah",
  MINA: "Mina",
  ARAFAT: "Arafat",
  OTHER: "Other",
};

const EVENT_TYPE_LABELS: Record<ItineraryEventType, string> = {
  ZIYARAH: "Ziyarah",
  MEAL: "Meal",
  TRANSPORT: "Transport",
  HOTEL_CHECK_IN: "Hotel Check-in",
  HOTEL_CHECK_OUT: "Hotel Check-out",
  FLIGHT: "Flight",
  FREE_TIME: "Free Time",
  BRIEFING: "Briefing",
  OTHER: "Other",
};

const STATUS_TONE: Record<"DRAFT" | "PUBLISHED", Tone> = {
  DRAFT: "warning",
  PUBLISHED: "success",
};

interface GroupInfo {
  id: string;
  groupName: string;
  groupCode: string;
  groupStatus: string;
  departureDate: string;
}

interface ItineraryBuilderViewProps {
  group: GroupInfo;
  itinerary: ItineraryRow | null;
  days: ItineraryDayRow[];
  events: ItineraryEventRow[];
  canManage: boolean;
}

export default function ItineraryBuilderView({
  group,
  itinerary,
  days,
  events,
  canManage,
}: ItineraryBuilderViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dayDialogOpen, setDayDialogOpen] = useState(false);
  const [eventDialogDayId, setEventDialogDayId] = useState<string | null>(null);
  const [deleteDayId, setDeleteDayId] = useState<string | null>(null);
  const [attendanceEvent, setAttendanceEvent] =
    useState<ItineraryEventRow | null>(null);

  const eventsByDay = new Map<string, ItineraryEventRow[]>();
  for (const e of events) {
    const list = eventsByDay.get(e.itineraryDayId) ?? [];
    list.push(e);
    eventsByDay.set(e.itineraryDayId, list);
  }

  const refresh = () => router.refresh();

  const publish = () => {
    if (!itinerary) return;
    startTransition(async () => {
      const result = await publishItineraryAction(group.id, itinerary.id);
      if (!result.ok) {
        toast.add({ title: "Could not publish", description: result.error });
        return;
      }
      toast.add({ title: "Itinerary published" });
      refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Itinerary — ${group.groupName}`}
        breadcrumb={[
          { title: "Operations", link: "/operations" },
          { title: "Itinerary & Services", link: "/itinerary-services" },
          { title: group.groupName, link: "#" },
        ]}
        subTitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {group.groupCode} · Departs {formatDate(group.departureDate)}
            </span>
            {itinerary && (
              <ToneBadge
                tone={STATUS_TONE[itinerary.status]}
                label={itinerary.status}
              />
            )}
          </span>
        }
        action={
          canManage &&
          itinerary &&
          itinerary.status === "DRAFT" &&
          days.length > 0 ? (
            <Button onClick={publish} disabled={isPending}>
              <UploadCloud /> Publish Itinerary
            </Button>
          ) : null
        }
      />

      {!itinerary && (
        <Card className="p-6 text-sm text-muted-foreground">
          Your role can view this group but not start building its itinerary.
        </Card>
      )}

      {itinerary && (
        <div className="flex flex-col gap-4">
          {days.map((day) => (
            <Card key={day.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Day {day.dayNumber} · {CITY_LABELS[day.city]}
                    {day.title && (
                      <span className="text-muted-foreground">
                        {" "}
                        — {day.title}
                      </span>
                    )}
                  </p>
                  {day.date && (
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {formatDate(day.date)}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEventDialogDayId(day.id)}
                    >
                      <Plus /> Add Event
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteDayId(day.id)}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-col divide-y divide-border/20">
                {(eventsByDay.get(day.id) ?? []).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-foreground">
                          {event.title}
                        </span>
                        <Badge variant="secondary">
                          {EVENT_TYPE_LABELS[event.eventType]}
                        </Badge>
                        {event.visibleToPilgrims && (
                          <Badge variant="outline">Pilgrim-visible</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {[
                          event.startTime,
                          event.location,
                          event.guideName,
                          event.supplierName,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No details yet"}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setAttendanceEvent(event)}
                        >
                          Attendance
                        </Button>
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Switch
                            checked={event.confirmed}
                            onCheckedChange={(checked) =>
                              startTransition(async () => {
                                const result = await toggleEventConfirmedAction(
                                  group.id,
                                  event.id,
                                  checked,
                                );
                                if (!result.ok)
                                  toast.add({
                                    title: "Could not update",
                                    description: result.error,
                                  });
                                else refresh();
                              })
                            }
                          />
                          Confirmed
                        </label>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            startTransition(async () => {
                              const result = await removeItineraryEventAction(
                                group.id,
                                event.id,
                              );
                              if (!result.ok)
                                toast.add({
                                  title: "Could not remove",
                                  description: result.error,
                                });
                              else refresh();
                            })
                          }
                        >
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
                {(eventsByDay.get(day.id) ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">
                    No events yet.
                  </p>
                )}
              </div>
            </Card>
          ))}

          {canManage && (
            <Button
              variant="outline_without_border"
              onClick={() => setDayDialogOpen(true)}
              className="self-start"
            >
              <Plus /> Add Day
            </Button>
          )}

          {days.length === 0 && !canManage && (
            <Card className="p-6 text-sm text-muted-foreground">
              No days have been added yet.
            </Card>
          )}
        </div>
      )}

      <AddDayDialog
        open={dayDialogOpen}
        onClose={() => setDayDialogOpen(false)}
        departureGroupId={group.id}
        itineraryId={itinerary?.id ?? ""}
        nextDayNumber={days.length + 1}
        onDone={refresh}
      />

      <AddEventDialog
        dayId={eventDialogDayId}
        departureGroupId={group.id}
        nextSortOrder={
          (eventDialogDayId &&
            (eventsByDay.get(eventDialogDayId)?.length ?? 0)) ||
          0
        }
        onClose={() => setEventDialogDayId(null)}
        onDone={refresh}
      />

      <Dialog
        open={deleteDayId !== null}
        onOpenChange={(next) => !next && setDeleteDayId(null)}
      >
        <DialogContent className="max-w-sm!">
          <DialogHeader>
            <DialogTitle>Delete this day?</DialogTitle>
            <DialogDescription>
              All of its events are removed too. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDayId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                startTransition(async () => {
                  if (!deleteDayId) return;
                  const result = await removeItineraryDayAction(
                    group.id,
                    deleteDayId,
                  );
                  setDeleteDayId(null);
                  if (!result.ok)
                    toast.add({
                      title: "Could not delete",
                      description: result.error,
                    });
                  else refresh();
                })
              }
            >
              Delete Day
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {attendanceEvent && (
        <AttendanceDialog
          departureGroupId={group.id}
          event={attendanceEvent}
          onClose={() => setAttendanceEvent(null)}
        />
      )}
    </div>
  );
}

function AttendanceDialog({
  departureGroupId,
  event,
  onClose,
}: {
  departureGroupId: string;
  event: ItineraryEventRow;
  onClose: () => void;
}) {
  const [attendance, setAttendanceRows] = useState<
    AttendanceWithPilgrim[] | null
  >(null);
  const [vouchers, setVouchers] = useState<VoucherWithPilgrim[] | null>(null);
  const [voucherTarget, setVoucherTarget] =
    useState<AttendanceWithPilgrim | null>(null);
  const loading = attendance === null;

  const load = () => {
    Promise.all([
      getEventAttendanceAction(departureGroupId, event.id),
      getEventVouchersAction(event.id),
    ]).then(([attendanceResult, vouchersResult]) => {
      setAttendanceRows(attendanceResult.attendance ?? []);
      setVouchers(vouchersResult.vouchers ?? []);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  const voucherByPilgrim = new Map(
    (vouchers ?? []).map((v) => [v.departureGroupPilgrimId, v]),
  );

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg! max-h-[75vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attendance — {event.title}</DialogTitle>
          <DialogDescription>
            {event.capacity
              ? `Capacity: ${event.capacity}`
              : "No capacity limit set for this event."}
          </DialogDescription>
        </DialogHeader>
        {loading || !attendance ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : attendance.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No travellers in this group yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2 py-2">
            {attendance.map((row) => {
              const voucher = voucherByPilgrim.get(row.departureGroupPilgrimId);
              return (
                <div
                  key={row.departureGroupPilgrimId}
                  className="flex items-center justify-between gap-2 py-1.5 border-b border-border/20 last:border-none"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">
                      {row.fullName}
                    </p>
                    {voucher && (
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {voucher.voucherCode} · {voucher.status}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Select
                      value={row.status}
                      onValueChange={async (v) => {
                        const status = v as AttendanceStatus;
                        const result = await setAttendanceAction(
                          departureGroupId,
                          event.id,
                          row.departureGroupPilgrimId,
                          status,
                        );
                        if (!result.ok) {
                          toast.add({
                            title: "Could not update attendance",
                            description: result.error,
                          });
                          return;
                        }
                        load();
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="REGISTERED">Registered</SelectItem>
                        <SelectItem value="ATTENDED">Attended</SelectItem>
                        <SelectItem value="NO_SHOW">No-show</SelectItem>
                        <SelectItem value="CANCELLED">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    {voucher ? (
                      voucher.status === "ISSUED" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const result = await updateVoucherStatusAction(
                              departureGroupId,
                              voucher.id,
                              "REDEEMED",
                            );
                            if (!result.ok)
                              return toast.add({
                                title: "Could not redeem",
                                description: result.error,
                              });
                            load();
                          }}
                        >
                          Redeem
                        </Button>
                      )
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setVoucherTarget(row)}
                      >
                        Voucher
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      {voucherTarget && (
        <IssueVoucherDialog
          departureGroupId={departureGroupId}
          eventId={event.id}
          defaultServiceName={event.title}
          pilgrim={voucherTarget}
          onClose={() => setVoucherTarget(null)}
          onDone={() => {
            setVoucherTarget(null);
            load();
          }}
        />
      )}
    </Dialog>
  );
}

function IssueVoucherDialog({
  departureGroupId,
  eventId,
  defaultServiceName,
  pilgrim,
  onClose,
  onDone,
}: {
  departureGroupId: string;
  eventId: string;
  defaultServiceName: string;
  pilgrim: AttendanceWithPilgrim;
  onClose: () => void;
  onDone: () => void;
}) {
  const [serviceName, setServiceName] = useState(defaultServiceName);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await issueVoucherAction({
      departureGroupId,
      departureGroupPilgrimId: pilgrim.departureGroupPilgrimId,
      itineraryEventId: eventId,
      serviceName,
      notes: notes || null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not issue voucher.");
      return;
    }
    toast.add({ title: "Voucher issued" });
    onDone();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm!">
        <DialogHeader>
          <DialogTitle>Issue voucher — {pilgrim.fullName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <InputGroupField
            label="Service"
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Notes (optional)
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !serviceName.trim()}>
            {submitting ? "Issuing…" : "Issue voucher"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddDayDialog({
  open,
  onClose,
  departureGroupId,
  itineraryId,
  nextDayNumber,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  departureGroupId: string;
  itineraryId: string;
  nextDayNumber: number;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [city, setCity] = useState<ItineraryCity>("MAKKAH");
  const [date, setDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const result = await addItineraryDayAction({
      departureGroupId,
      itineraryId,
      dayNumber: nextDayNumber,
      city,
      title,
      date: date || null,
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.add({ title: "Could not add day", description: result.error });
      return;
    }
    setTitle("");
    setDate("");
    onClose();
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Add Day {nextDayNumber}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              City
            </label>
            <Select
              value={city}
              onValueChange={(v) => setCity(v as ItineraryCity)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ["MAKKAH", "MADINAH", "MINA", "ARAFAT", "OTHER"] as const
                ).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CITY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <InputGroupField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Arrival & Umrah"
          />
          <InputGroupField
            label="Date (optional)"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Adding…" : "Add Day"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddEventDialog({
  dayId,
  departureGroupId,
  nextSortOrder,
  onClose,
  onDone,
}: {
  dayId: string | null;
  departureGroupId: string;
  nextSortOrder: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<ItineraryEventType>("ZIYARAH");
  const [startTime, setStartTime] = useState("");
  const [location, setLocation] = useState("");
  const [guideName, setGuideName] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [visibleToPilgrims, setVisibleToPilgrims] = useState(false);
  const [pilgrimFacingNotes, setPilgrimFacingNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!dayId) return;
    setSubmitting(true);
    setError(null);
    const result = await addItineraryEventAction({
      itineraryDayId: dayId,
      departureGroupId,
      sortOrder: nextSortOrder,
      startTime: startTime || null,
      title,
      eventType,
      location: location || null,
      guideName: guideName || null,
      supplierName: supplierName || null,
      capacity: null,
      internalNotes: internalNotes || null,
      pilgrimFacingNotes: pilgrimFacingNotes || null,
      visibleToPilgrims,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add the event.");
      return;
    }
    setTitle("");
    setStartTime("");
    setLocation("");
    setGuideName("");
    setSupplierName("");
    setVisibleToPilgrims(false);
    setPilgrimFacingNotes("");
    setInternalNotes("");
    onClose();
    onDone();
  };

  return (
    <Dialog open={dayId !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg! max-h-[85vh] overflow-y-auto no-scrollbar">
        <DialogHeader>
          <DialogTitle>Add Event</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Type
              </label>
              <Select
                value={eventType}
                onValueChange={(v) => setEventType(v as ItineraryEventType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(EVENT_TYPE_LABELS) as ItineraryEventType[]).map(
                    (t) => (
                      <SelectItem key={t} value={t}>
                        {EVENT_TYPE_LABELS[t]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <InputGroupField
              label="Start time (optional)"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <InputGroupField
            label="Title *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Ziyarah to Jabal Uhud"
          />
          <div className="grid grid-cols-2 gap-3">
            <InputGroupField
              label="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
            <InputGroupField
              label="Guide"
              value={guideName}
              onChange={(e) => setGuideName(e.target.value)}
            />
          </div>
          <InputGroupField
            label="Supplier"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Internal notes (staff only)
            </label>
            <Textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <Switch
              checked={visibleToPilgrims}
              onCheckedChange={setVisibleToPilgrims}
            />
            Visible to pilgrims (once the itinerary is published)
          </label>
          {visibleToPilgrims && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Pilgrim-facing wording *
              </label>
              <Textarea
                value={pilgrimFacingNotes}
                onChange={(e) => setPilgrimFacingNotes(e.target.value)}
                rows={2}
                placeholder="What the pilgrim is told about this event."
              />
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Adding…" : "Add Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
