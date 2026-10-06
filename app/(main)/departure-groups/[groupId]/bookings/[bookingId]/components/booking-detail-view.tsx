"use client";

import { useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import PageHeader from "@/components/page-header";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/data-table/kpi-card";
import SectionHeading from "@/components/section-heading";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import {
  capabilitiesFor,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import {
  Ban,
  FileText,
  MegaphoneIcon,
  MoreHorizontal,
  Pencil,
  Phone,
  ArrowRightLeft,
  Plus,
  TriangleAlert,
  UserRound,
  Wallet,
  X,
} from "lucide-react";

import {
  BookingStatusBadge,
  PaymentStatusBadge,
  ProgressBar,
  SeatStatusBadge,
  VisaStatusBadge,
} from "../../../../components/status-badges";
import {
  describeCharge,
  type ChargeDescriptionContext,
} from "../../../../billing-description";
import BookingAiAnalysisTab from "./booking-ai-analysis-tab";
import CancelBookingDialog from "../../../components/cancel-booking-dialog";
import EditBookingDialog from "../../../components/edit-booking-dialog";
import InvoicePreviewDialog from "../../../components/invoice-preview-dialog";
import MoveBookingDialog from "../../../components/move-booking-dialog";
import RecordPaymentDialog from "../../../components/record-payment-dialog";
import SendReminderDialog, {
  type ReminderKind,
} from "../../../components/send-reminder-dialog";
import type {
  DepartureGroupAccommodation,
  DepartureGroupBooking,
  DepartureGroupFlight,
  DepartureGroupListItem,
  DepartureGroupManifestRow,
  DepartureGroupPackageSnapshot,
  DepartureGroupTransport,
  GroupActivityLog,
  MoveTargetGroupOption,
  PilgrimCharge,
  ServiceAddon,
  TravellerRelationship,
} from "../../../../types";
import {
  ROOM_TYPE_LABELS,
  formatDate,
  formatDateTime,
  formatExactCurrency,
  initialsOf,
} from "../../../../utils";

import { setBookingCampaignAction } from "@/app/(main)/campaigns/actions";
import type { BookingCampaignAttribution, CampaignOption } from "@/lib/data/campaigns-repository";
import type { AttributionType } from "@/lib/types/campaigns";
import {
  addTravellerRelationshipAction,
  removeTravellerRelationshipAction,
  setBookingPayerAction,
} from "../../../../actions";
import type { TravellerRelationshipType } from "@/lib/data/departure-groups-bookings";

type BookingTabId =
  | "overview"
  | "travellers"
  | "charges"
  | "payments"
  | "documents"
  | "activity"
  | "ai-analysis";

const TAB_LABELS: Record<BookingTabId, string> = {
  overview: "Overview",
  travellers: "Travellers",
  charges: "Commercials",
  payments: "Payments",
  documents: "Documents",
  activity: "Activity",
  "ai-analysis": "AI Analysis",
};

const RELATIONSHIP_LABELS: Record<TravellerRelationshipType, string> = {
  MAHRAM: "mahram",
  SPOUSE: "spouse",
  PARENT: "parent",
  CHILD: "child",
  SIBLING: "sibling",
  COMPANION: "companion",
  OTHER: "related",
};

function orderedCharges(charges: PilgrimCharge[]): PilgrimCharge[] {
  return charges
    .filter((c) => c.voidedAt === null)
    .sort((a, b) => {
      if (a.chargeType === "BASE_FARE" && b.chargeType !== "BASE_FARE")
        return -1;
      if (b.chargeType === "BASE_FARE" && a.chargeType !== "BASE_FARE")
        return 1;
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
}

function Fact({
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
      <span className={cn("text-sm text-foreground", mono && "font-number")}>
        {value}
      </span>
    </div>
  );
}

interface BookingDetailViewProps {
  booking: DepartureGroupBooking;
  travellers: DepartureGroupManifestRow[];
  group: DepartureGroupListItem;
  snapshot: DepartureGroupPackageSnapshot;
  activity: GroupActivityLog[];
  flights: DepartureGroupFlight[];
  accommodations: DepartureGroupAccommodation[];
  transports: DepartureGroupTransport[];
  serviceAddons: ServiceAddon[];
  moveTargets: MoveTargetGroupOption[];
  role: StaffRole;
  canInvoice: boolean;
  overdueBookingIds: string[];
  campaignAttribution: BookingCampaignAttribution;
  campaignOptions: CampaignOption[];
  travellerRelationships: TravellerRelationship[];
}

/**
 * The booking's in-depth screen. Reuses every dialog the Pilgrims & Bookings
 * tab already uses for mutations (edit, move, cancel, record payment, send
 * reminder, generate invoice) — this page only adds a permanent, linkable
 * home for the read view that used to be a dialog.
 */
export default function BookingDetailView({
  booking,
  travellers,
  group,
  snapshot,
  activity,
  flights,
  accommodations,
  transports,
  serviceAddons,
  moveTargets,
  role,
  canInvoice,
  overdueBookingIds,
  campaignAttribution,
  campaignOptions,
  travellerRelationships,
}: BookingDetailViewProps) {
  const router = useRouter();
  const can = capabilitiesFor(role);
  const currency = snapshot.currency || "LKR";
  const [tab, setTab] = useState<BookingTabId>("overview");
  const [campaignId, setCampaignId] = useState(campaignAttribution.campaignId ?? "NONE");
  const [attributionType, setAttributionType] = useState<AttributionType>(campaignAttribution.attributionType);
  const [savingAttribution, setSavingAttribution] = useState(false);

  const [payerName, setPayerName] = useState(booking.payerName ?? "");
  const [payerEmail, setPayerEmail] = useState(booking.payerEmail ?? "");
  const [savingPayer, setSavingPayer] = useState(false);
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const [relFrom, setRelFrom] = useState("");
  const [relTo, setRelTo] = useState("");
  const [relType, setRelType] = useState<TravellerRelationshipType>("MAHRAM");
  const [relIsMahram, setRelIsMahram] = useState(true);
  const [savingRelationship, setSavingRelationship] = useState(false);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);

  const savePayer = async () => {
    setSavingPayer(true);
    const result = await setBookingPayerAction({
      bookingId: booking.id,
      departureGroupId: group.id,
      payerName: payerName.trim() || null,
      payerEmail: payerEmail.trim() || null,
    });
    setSavingPayer(false);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not update the payer" });
      return;
    }
    toast.add({ title: "Payer updated" });
  };

  const openRelationshipDialog = () => {
    setRelFrom("");
    setRelTo("");
    setRelType("MAHRAM");
    setRelIsMahram(true);
    setRelationshipError(null);
    setRelationshipOpen(true);
  };

  const submitRelationship = async () => {
    if (!relFrom || !relTo) {
      setRelationshipError("Choose both travellers.");
      return;
    }
    setSavingRelationship(true);
    const result = await addTravellerRelationshipAction({
      bookingId: booking.id,
      departureGroupId: group.id,
      fromPilgrimId: relFrom,
      toPilgrimId: relTo,
      relationship: relType,
      isMahram: relIsMahram,
    });
    setSavingRelationship(false);
    if (!result.ok) {
      setRelationshipError(result.error);
      return;
    }
    toast.add({ title: "Relationship recorded" });
    setRelationshipOpen(false);
  };

  const removeRelationship = async (relationshipId: string) => {
    const result = await removeTravellerRelationshipAction({
      relationshipId,
      bookingId: booking.id,
      departureGroupId: group.id,
    });
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not remove the relationship" });
      return;
    }
  };

  const saveAttribution = async (nextCampaignId: string, nextAttributionType: AttributionType) => {
    setSavingAttribution(true);
    const result = await setBookingCampaignAction({
      bookingId: booking.id,
      groupId: group.id,
      campaignId: nextCampaignId === "NONE" ? null : nextCampaignId,
      attributionType: nextAttributionType,
    });
    setSavingAttribution(false);
    if (!result.ok) {
      toast.add({ title: result.error ?? "Could not update attribution" });
      return;
    }
  };

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reminder, setReminder] = useState<ReminderKind | null>(null);

  const isHold = booking.bookingStatus === "HELD";
  const isOverdue = overdueBookingIds.includes(booking.id);

  const descriptionContext: ChargeDescriptionContext = {
    accommodations,
    flights,
    transports,
    addons: serviceAddons,
    itinerary: snapshot.itinerary,
  };

  const liveCharges = travellers.flatMap((t) =>
    t.charges.filter((c) => c.voidedAt === null),
  );
  const billableCharges = liveCharges.filter(
    (c) => !(c.requiresApproval && !c.approvedAt),
  );
  const pendingCharges = liveCharges.filter(
    (c) => c.requiresApproval && !c.approvedAt,
  );
  const baseFareTotal = billableCharges
    .filter((c) => c.chargeType === "BASE_FARE")
    .reduce((sum, c) => sum + c.amount * c.quantity, 0);
  const customisationsTotal = billableCharges
    .filter((c) => c.chargeType !== "BASE_FARE")
    .reduce((sum, c) => sum + c.amount * c.quantity, 0);
  const pendingTotal = pendingCharges.reduce(
    (sum, c) => sum + c.amount * c.quantity,
    0,
  );

  const bookingActivity = activity.filter(
    (entry) =>
      entry.entityId === booking.id ||
      entry.message.includes(booking.bookingReference),
  );

  const tabs: BookingTabId[] = [
    "overview",
    "travellers",
    ...(can.viewFinance ? (["charges", "payments"] as BookingTabId[]) : []),
    "documents",
    "activity",
    "ai-analysis",
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Booking ${booking.bookingReference}`}
        breadcrumb={[
          { title: "Departure Groups", link: "/departure-groups" },
          { title: group.groupName, link: `/departure-groups/${group.id}` },
          {
            title: "Pilgrims & Bookings",
            link: `/departure-groups/${group.id}?tab=pilgrims`,
          },
          { title: booking.bookingReference, link: "#" },
        ]}
        subTitle={
          <span className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge value={booking.bookingStatus} />
            {isOverdue && (
              <Badge variant="destructive" className="gap-1">
                <TriangleAlert className="size-3" /> Overdue
              </Badge>
            )}
            <span>
              {booking.travellerCount} traveller
              {booking.travellerCount === 1 ? "" : "s"} ·{" "}
              {ROOM_TYPE_LABELS[booking.roomOccupancyPreference]} occupancy
            </span>
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            {can.recordPayments && booking.outstandingBalance > 0 && (
              <Button variant="outline_without_border" onClick={() => setPaymentOpen(true)}>
                <Wallet /> Record Payment
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {can.addBookings && (
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    <Pencil /> Edit Booking
                  </DropdownMenuItem>
                )}
                {can.sendGroupCommunications && (
                  <DropdownMenuItem onClick={() => setReminder("PAYMENT")}>
                    <MegaphoneIcon /> Send Reminder
                  </DropdownMenuItem>
                )}
                {canInvoice && (
                  <DropdownMenuItem onClick={() => setInvoiceOpen(true)}>
                    <FileText /> Generate Invoice
                  </DropdownMenuItem>
                )}
                {can.editGroupDetails && (
                  <DropdownMenuItem onClick={() => setMoveOpen(true)}>
                    <ArrowRightLeft /> Move to Another Group
                  </DropdownMenuItem>
                )}
                {can.cancelBookings && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setCancelOpen(true)}
                  >
                    <Ban /> Cancel Booking
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* Primary contact */}
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
          {initialsOf(booking.primaryContactName)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {booking.primaryContactName}
          </p>
          <p className="text-xs text-muted-foreground font-number flex items-center gap-1.5">
            <Phone className="size-3" />
            {booking.primaryContactPhone}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as BookingTabId)}>
        <TabsList>
          {tabs.map((id) => (
            <TabsTrigger key={id} value={id}>
              {TAB_LABELS[id]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "overview" && (
        <div className="flex flex-col gap-4">
          <div className="grid p-1 grid-cols-2 sm:grid-cols-4 gap-4">
            <Fact label="Travellers" value={booking.travellerCount} mono />
            <Fact
              label="Room occupancy"
              value={ROOM_TYPE_LABELS[booking.roomOccupancyPreference]}
            />
            <Fact label="Booked" value={formatDate(booking.bookedAt)} />
            <Fact label="Created" value={formatDate(booking.createdAt)} />
            {isHold && (
              <Fact
                label="Seat hold expires"
                value={formatDateTime(booking.seatHoldExpiresAt)}
              />
            )}
            {can.viewFinance && booking.nextDueAt && (
              <Fact label="Next payment due" value={formatDate(booking.nextDueAt)} />
            )}
          </div>

          {can.viewFinance && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard
                title="Total booking value"
                value={formatExactCurrency(booking.totalBookingValue, currency)}
              />
              <KpiCard
                title="Amount paid"
                value={formatExactCurrency(booking.amountPaid, currency)}
              />
              <KpiCard
                title="Outstanding balance"
                value={formatExactCurrency(booking.outstandingBalance, currency)}
                desc={
                  booking.outstandingBalance > 0 ? (
                    <span className={TONE_TEXT.warning}>Payment due</span>
                  ) : (
                    <span className={TONE_TEXT.success}>Settled in full</span>
                  )
                }
              />
              <KpiCard
                title="Average per traveller"
                value={formatExactCurrency(
                  booking.packagePricePerPerson,
                  currency,
                )}
              />
            </div>
          )}

          <Card className="p-4 flex flex-col gap-3 max-w-md">
            <p className="text-sm font-medium text-foreground">Campaign attribution</p>
            {can.editGroupDetails ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Campaign</label>
                  <Select
                    value={campaignId}
                    onValueChange={(v) => {
                      const next = v ?? "NONE";
                      setCampaignId(next);
                      saveAttribution(next, attributionType);
                    }}
                    disabled={savingAttribution}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">No campaign</SelectItem>
                      {campaignOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {campaignId !== "NONE" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Attribution</label>
                    <Select
                      value={attributionType}
                      onValueChange={(v) => {
                        const next = (v ?? "UNKNOWN") as AttributionType;
                        setAttributionType(next);
                        saveAttribution(campaignId, next);
                      }}
                      disabled={savingAttribution}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DIRECT">Direct</SelectItem>
                        <SelectItem value="ASSISTED">Assisted</SelectItem>
                        <SelectItem value="UNKNOWN">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {campaignOptions.find((c) => c.id === campaignAttribution.campaignId)?.name ?? "No campaign attributed"}
              </p>
            )}
          </Card>

          <Card className="p-4 flex flex-col gap-3 max-w-md">
            <p className="text-sm font-medium text-foreground">Payer</p>
            <p className="text-xs text-muted-foreground">
              Who is actually settling this booking, if different from the
              on-the-ground contact above.
            </p>
            {can.addBookings ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Name
                  </label>
                  <Input
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                    placeholder={booking.primaryContactName}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Email
                  </label>
                  <Input
                    type="email"
                    value={payerEmail}
                    onChange={(e) => setPayerEmail(e.target.value)}
                    placeholder="payer@example.com"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline_without_border"
                  className="self-start"
                  disabled={
                    savingPayer ||
                    (payerName.trim() === (booking.payerName ?? "") &&
                      payerEmail.trim() === (booking.payerEmail ?? ""))
                  }
                  onClick={savePayer}
                >
                  {savingPayer ? "Saving…" : "Save payer"}
                </Button>
              </>
            ) : (
              <p className="text-xs text-foreground">
                {booking.payerName ?? "Same as primary contact"}
              </p>
            )}
          </Card>
        </div>
      )}

      {tab === "travellers" && (
        <div className="flex flex-col gap-4">
        <Card className="p-0 overflow-x-auto no-scrollbar">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {["Pilgrim", "Passport", "Seat", "Visa", "Payment", "Docs"].map(
                  (label) => (
                    <TableHead
                      key={label}
                      className="h-9 px-3 text-xs font-medium text-muted-foreground"
                    >
                      {label}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {travellers.map((traveller) => (
                <TableRow
                  key={traveller.id}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() =>
                    router.push(
                      `/departure-groups/${group.id}/pilgrim/${traveller.pilgrimId}`,
                    )
                  }
                >
                  <TableCell className="px-3 py-2.5 text-sm text-foreground">
                    {traveller.fullName}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-xs font-number text-muted-foreground">
                    {traveller.passportNumber ?? "—"}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <SeatStatusBadge value={traveller.seatStatus} />
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <VisaStatusBadge value={traveller.visaStatus} />
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <PaymentStatusBadge value={traveller.paymentStatus} />
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <div className="flex flex-col gap-1 min-w-20">
                      <span className="text-[11px] font-number text-foreground">
                        {traveller.documentsCompleted} / {traveller.documentsRequired}
                      </span>
                      <ProgressBar percent={traveller.documentCompletionPercent} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                Traveller relationships
              </p>
              <p className="text-xs text-muted-foreground">
                Mahram, spouse and family links between travellers on this
                booking.
              </p>
            </div>
            {can.addBookings && travellers.length >= 2 && (
              <Button size="sm" variant="outline_without_border" onClick={openRelationshipDialog}>
                <Plus /> Add
              </Button>
            )}
          </div>
          {travellerRelationships.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No relationships recorded yet.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border/20">
              {travellerRelationships.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm text-foreground min-w-0">
                    <UserRound className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">
                      {r.fromName} is {RELATIONSHIP_LABELS[r.relationship]} of{" "}
                      {r.toName}
                    </span>
                    {r.isMahram && (
                      <Badge variant="secondary" className="shrink-0">
                        Mahram
                      </Badge>
                    )}
                  </div>
                  {can.addBookings && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove relationship"
                      onClick={() => removeRelationship(r.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        </div>
      )}

      {tab === "charges" && can.viewFinance && (
        <div className="flex flex-col gap-4">
          <Card className="p-3 shadow-xs min-h-fit flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground text-[15px]">Base fare</span>
              <span className="font-number text-[15px]">
                {formatExactCurrency(baseFareTotal, currency)}
              </span>
            </div>
            {customisationsTotal !== 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground text-[15px]">
                  Customisations
                </span>
                <span className="font-number text-[15px]">
                  {formatExactCurrency(customisationsTotal, currency)}
                </span>
              </div>
            )}
            {pendingTotal !== 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className={cn("text-[15px]", TONE_TEXT.warning)}>
                  Pending approval (not yet billed)
                </span>
                <span className={cn("font-number text-[15px]", TONE_TEXT.warning)}>
                  {formatExactCurrency(pendingTotal, currency)}
                </span>
              </div>
            )}
          </Card>

          <div>
            <SectionHeading title="Charges by traveller" />
            <div className="flex flex-col gap-3 mt-3">
              {travellers.map((traveller) => {
                const live = orderedCharges(traveller.charges);
                if (live.length === 0) return null;
                const subtotal = live.reduce(
                  (sum, c) => sum + c.amount * c.quantity,
                  0,
                );
                const voided = traveller.charges.filter((c) => c.voidedAt !== null);

                return (
                  <Card key={traveller.id} className="p-3 shadow-xs flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-foreground">
                        {traveller.fullName}
                      </span>
                      <span className="text-xs font-number text-muted-foreground">
                        {formatExactCurrency(subtotal, currency)}
                      </span>
                    </div>
                    <div className="flex flex-col divide-y divide-border/20">
                      {live.map((charge) => {
                        const deviation = traveller.deviations.find(
                          (d) => d.chargeId === charge.id,
                        );
                        const { title, details } = describeCharge(
                          charge,
                          deviation,
                          descriptionContext,
                        );
                        return (
                          <div
                            key={charge.id}
                            className="flex items-start justify-between gap-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm text-foreground truncate">{title}</p>
                              {details.map((line: string, i: number) => (
                                <p key={i} className="text-[11px] text-muted-foreground">
                                  {line}
                                </p>
                              ))}
                              {charge.requiresApproval && !charge.approvedAt && (
                                <p className={`text-[11px] ${TONE_TEXT.warning}`}>
                                  Awaiting approval
                                </p>
                              )}
                            </div>
                            <span
                              className={cn(
                                "text-sm font-number shrink-0",
                                charge.amount < 0 ? TONE_TEXT.success : "text-foreground",
                              )}
                            >
                              {charge.amount < 0 ? "-" : ""}
                              {formatExactCurrency(
                                Math.abs(charge.amount) * charge.quantity,
                                currency,
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {voided.length > 0 && (
                      <details className="text-[11px] text-muted-foreground">
                        <summary className="cursor-pointer">
                          {voided.length} voided line{voided.length === 1 ? "" : "s"}
                        </summary>
                        <div className="flex flex-col gap-1 mt-1">
                          {voided.map((c) => (
                            <p key={c.id} className="line-through">
                              {c.label} —{" "}
                              {formatExactCurrency(
                                Math.abs(c.amount) * c.quantity,
                                currency,
                              )}
                              {c.voidReason ? ` · ${c.voidReason}` : ""}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === "payments" && can.viewFinance && (
        <div className="flex flex-col gap-4">
          <Card className="p-3 shadow-xs flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground text-[15px]">Amount paid</span>
              <span className={cn("font-number text-[15px]", TONE_TEXT.success)}>
                {formatExactCurrency(booking.amountPaid, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground text-[15px]">
                Outstanding balance
              </span>
              <span
                className={cn(
                  "font-number text-[15px]",
                  booking.outstandingBalance > 0 && "text-destructive",
                )}
              >
                {formatExactCurrency(booking.outstandingBalance, currency)}
              </span>
            </div>
            {booking.nextDueAt && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground text-[15px]">Next due</span>
                <span className="font-number text-[15px]">
                  {formatDate(booking.nextDueAt)}
                </span>
              </div>
            )}
          </Card>
          <p className="text-xs text-muted-foreground">
            Full transaction history, invoices and refunds for this booking live
            in{" "}
            <a href="/finance?view=receivables&subview=balances" className="underline">
              Finance
            </a>
            .
          </p>
        </div>
      )}

      {tab === "documents" && (
        <Card className="p-0 overflow-x-auto no-scrollbar">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {["Pilgrim", "Documents", "Progress"].map((label) => (
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
              {travellers.map((traveller) => (
                <TableRow key={traveller.id} className="hover:bg-muted/40">
                  <TableCell className="px-3 py-2.5 text-sm text-foreground">
                    {traveller.fullName}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-xs font-number text-muted-foreground">
                    {traveller.documentsCompleted} / {traveller.documentsRequired}
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <ProgressBar percent={traveller.documentCompletionPercent} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {tab === "activity" && (
        <Card className="p-4">
          {bookingActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No activity recorded for this booking yet.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {bookingActivity.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-0.5 text-sm">
                  <p className="text-foreground">{entry.message}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {entry.actorName} · {formatDateTime(entry.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "ai-analysis" && (
        <BookingAiAnalysisTab
          bookingId={booking.id}
          outstandingBalance={booking.outstandingBalance}
          nextDueAt={booking.nextDueAt}
          primaryContactName={booking.primaryContactName}
          primaryContactPhone={booking.primaryContactPhone}
          departureDate={group.departureDate}
          travellerCount={booking.travellerCount}
          totalBookingValue={booking.totalBookingValue}
          travellers={travellers.map((t) => ({
            fullName: t.fullName,
            passportNumber: t.passportNumber,
            visaStatus: t.visaStatus,
            roomAssignmentStatus: t.roomAssignmentStatus,
            flightStatus: t.flightStatus,
          }))}
        />
      )}

      {/* Mutation dialogs — same components the Pilgrims & Bookings tab uses. */}
      <RecordPaymentDialog
        booking={booking}
        currency={currency}
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
      />

      {can.editGroupDetails && (
        <MoveBookingDialog
          booking={booking}
          travellers={travellers}
          targets={moveTargets}
          role={role}
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
        />
      )}

      {can.sendGroupCommunications && (
        <SendReminderDialog
          kind={reminder}
          booking={booking}
          travellers={travellers}
          group={group}
          activity={activity}
          role={role}
          currency={currency}
          open={reminder !== null}
          onClose={() => setReminder(null)}
        />
      )}

      {can.addBookings && (
        <EditBookingDialog
          booking={booking}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}

      {can.cancelBookings && (
        <CancelBookingDialog
          booking={booking}
          travellers={travellers}
          role={role}
          currency={currency}
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
        />
      )}

      {can.addBookings && (
        <Dialog open={relationshipOpen} onOpenChange={setRelationshipOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Traveller Relationship</DialogTitle>
              <DialogDescription>
                Both travellers must already be on this booking.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Traveller
                </label>
                <Select value={relFrom} onValueChange={(v) => setRelFrom(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Choose a traveller" /></SelectTrigger>
                  <SelectContent>
                    {travellers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Relationship
                </label>
                <Select
                  value={relType}
                  onValueChange={(v) => setRelType((v ?? "MAHRAM") as TravellerRelationshipType)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RELATIONSHIP_LABELS) as TravellerRelationshipType[]).map(
                      (type) => (
                        <SelectItem key={type} value={type}>
                          {RELATIONSHIP_LABELS[type]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  of
                </label>
                <Select value={relTo} onValueChange={(v) => setRelTo(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Choose a traveller" /></SelectTrigger>
                  <SelectContent>
                    {travellers
                      .filter((t) => t.id !== relFrom)
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.fullName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={relIsMahram}
                  onCheckedChange={(v) => setRelIsMahram(Boolean(v))}
                />
                Satisfies a mahram requirement
              </label>
              {relationshipError && (
                <p className="text-xs text-destructive">{relationshipError}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline_without_border"
                onClick={() => setRelationshipOpen(false)}
              >
                Cancel
              </Button>
              <Button disabled={savingRelationship} onClick={submitRelationship}>
                {savingRelationship ? "Saving…" : "Add relationship"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {canInvoice && (
        <InvoicePreviewDialog
          booking={booking}
          travellers={travellers}
          group={group}
          role={role}
          currency={currency}
          open={invoiceOpen}
          onClose={() => setInvoiceOpen(false)}
          accommodations={accommodations}
          flights={flights}
          transports={transports}
          serviceAddons={serviceAddons}
          itinerary={snapshot.itinerary}
        />
      )}
    </div>
  );
}
