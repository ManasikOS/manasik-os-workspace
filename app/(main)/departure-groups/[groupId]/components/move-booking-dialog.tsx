"use client";

import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import {
  capabilitiesFor,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import { moveBookingSchema } from "@/lib/validations/departure-groups";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Loader2,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useMemo, useState, useTransition } from "react";

import { moveBookingToGroupAction } from "../../actions";
import { SalesStatusBadge } from "../../components/status-badges";
import type {
  DepartureGroupBooking,
  DepartureGroupManifestRow,
  MoveTargetGroupOption,
} from "../../types";
import { ROOM_TYPE_LABELS, formatDate, formatExactCurrency } from "../../utils";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import SearchInput from "@/components/ui/search-input";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";

interface MoveBookingDialogProps {
  booking: DepartureGroupBooking | null;
  /** Travellers on this booking (manifest rows filtered by booking id). */
  travellers: DepartureGroupManifestRow[];
  /** Groups still open for travel, excluding the one being viewed. */
  targets: MoveTargetGroupOption[];
  role: StaffRole;
  open: boolean;
  onClose: () => void;
}

/**
 * Moves a booking and everyone on it into another departure group.
 *
 * The move is destructive in ways that are not obvious from the row action, so
 * the dialog states them before the operator commits: rooming is released, every
 * traveller drops back to PENDING on flights, the document requirement count
 * rebases onto the target group's snapshot, and the payment due date follows the
 * new departure date. Seat fit is checked against the target up front — a group
 * without room for the whole booking cannot be picked at all.
 */
const MoveBookingDialog = ({
  booking,
  travellers,
  targets,
  role,
  open,
  onClose,
}: MoveBookingDialogProps) => {
  const can = capabilitiesFor(role);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [step, setStep] = useState<1 | 2>(1);
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [reprice, setReprice] = useState(true);
  const [priceOverride, setPriceOverride] = useState<string | null>(null);
  const [reissueReference, setReissueReference] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between opens (so it can animate), so the
  // wizard has to reset each time it opens rather than only on first mount.
  useResetOnOpen(open, booking?.id ?? "", () => {
    setStep(1);
    setSearch("");
    setTargetId(null);
    setReprice(true);
    setPriceOverride(null);
    setReissueReference(false);
    setNote("");
    setError(null);
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return targets;
    return targets.filter((target) =>
      [target.groupName, target.groupCode, target.packageName, target.branch]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [search, targets]);

  const target = targets.find((option) => option.id === targetId) ?? null;
  const needsSeats =
    booking?.bookingStatus !== "WAITLIST" &&
    booking?.bookingStatus !== "CANCELLED";

  const assignedRooms = travellers.filter((t) => t.roomId).length;
  const currency = target?.currency || "LKR";

  // The rate the booking's own occupancy tier carries in the target group.
  const tierPrice =
    target && booking
      ? target.priceByRoomType[booking.roomOccupancyPreference]
      : null;
  const canReprice = can.overrideCapacityAndPrice && can.viewFinance;
  const rateAvailable = tierPrice !== null;
  const rate = tierPrice ?? booking?.packagePricePerPerson ?? 0;
  const willReprice = canReprice && reprice && rateAvailable;

  const parsedOverride =
    priceOverride === null
      ? null
      : Math.max(0, Math.round(Number(priceOverride) || 0));
  const newPrice = willReprice
    ? (parsedOverride ?? rate)
    : (booking?.packagePricePerPerson ?? 0);
  const newTotal = newPrice * (booking?.travellerCount ?? 0);
  const newOutstanding = Math.max(newTotal - (booking?.amountPaid ?? 0), 0);
  const belowCollected = newTotal < (booking?.amountPaid ?? 0);

  const submit = () => {
    setError(null);

    if (!booking) return;

    if (!target) {
      setError("Pick the group to move this booking into.");
      return;
    }
    if (needsSeats && target.availableSeats < booking.travellerCount) {
      setError(
        `${target.groupName} has only ${target.availableSeats} seat${
          target.availableSeats === 1 ? "" : "s"
        } left and this booking needs ${booking.travellerCount}.`,
      );
      return;
    }
    if (belowCollected) {
      setError(
        `That rate puts the booking total at ${formatExactCurrency(
          newTotal,
          currency,
        )}, below the ${formatExactCurrency(
          booking.amountPaid,
          currency,
        )} already collected. Raise a refund first.`,
      );
      return;
    }

    const payload = {
      bookingId: booking.id,
      fromGroupId: booking.departureGroupId,
      toGroupId: target.id,
      pricePerPerson:
        willReprice && newPrice !== booking.packagePricePerPerson
          ? newPrice
          : undefined,
      reissueReference,
      note: note.trim() || undefined,
    };

    const check = moveBookingSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That move is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await moveBookingToGroupAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const parts = [
        `${
          result.previousReference === result.bookingReference
            ? result.bookingReference
            : `${result.previousReference} → ${result.bookingReference}`
        } moved to ${result.toGroupName} (${result.toGroupCode}) with ${
          result.travellerCount
        } traveller${result.travellerCount === 1 ? "" : "s"}.`,
      ];
      if (result.releasedRoomAssignments > 0) {
        parts.push(
          `${result.releasedRoomAssignments} room assignment${
            result.releasedRoomAssignments === 1 ? "" : "s"
          } released.`,
        );
      }
      if (result.repriced && can.viewFinance) {
        parts.push(
          `Total ${formatExactCurrency(
            result.totalBookingValue,
            currency,
          )}, outstanding ${formatExactCurrency(
            result.outstandingBalance,
            currency,
          )}.`,
        );
      }

      toast.add({
        title: "Booking moved",
        description: parts.join(" "),
      });
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl flex flex-col gap-0  h-[calc(100vh-5rem)]">
        <DialogHeader className="">
          <DialogTitle>Move to Another Group</DialogTitle>
          <DialogDescription>
            {booking?.bookingReference} · {booking?.primaryContactName} ·{" "}
            {booking?.travellerCount} traveller
            {booking?.travellerCount === 1 ? "" : "s"} ·{" "}
            {booking && ROOM_TYPE_LABELS[booking.roomOccupancyPreference]}{" "}
            occupancy
          </DialogDescription>
          <div className="flex items-center gap-2 mt-4">
            <StepChip
              index={1}
              label="Select Group"
              active={step === 1}
              done={step === 2}
              onClick={() => {
                setStep(1);
                setError(null);
              }}
            />
            <div className="h-px flex-1 bg-border" />
            <StepChip
              index={2}
              label="Configure Move"
              active={step === 2}
              done={false}
            />
          </div>
        </DialogHeader>

        {booking && (
          <div className="flex flex-col gap-4 h-full overflow-y-auto custom-scroll mt-3">
            {step === 1 && (
              <>
                {targets.length === 0 ? (
                  <p className="text-sm text-muted-foreground ">
                    There is no other group open for travel to move this booking
                    into.
                  </p>
                ) : (
                  <>
                    <div className="">
                      <SearchInput
                        value={search}
                        onChange={(value) => {
                          setSearch(value);
                        }}
                        placeholder="Searcg group, code, package, branch..."
                      />
                    </div>

                    <div className="flex  pb-13 flex-col gap-2 overflow-y-auto custom-scroll">
                      {rows.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          No group matches that search.
                        </p>
                      )}
                      {rows.map((option) => {
                        const short =
                          option.availableSeats < booking.travellerCount;
                        const blocked = needsSeats && short;
                        const isSelected = option.id === targetId;
                        return (
                          <Card
                            key={option.id}
                            aria-pressed={isSelected}
                            onClick={() => {
                              if (!blocked) {
                                setTargetId(option.id);
                                setPriceOverride(null);
                                setReprice(true);
                                setError(null);
                                setStep(2);
                              }
                            }}
                            className={cn(
                              "flex flex-row min-h-fit shadow-xs  px-4 py-3 items-start justify-between gap-3 rounded-sm border-none  text-left transition-colors cursor-pointer",
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "border-border/50 hover:bg-muted/50",
                              blocked && "opacity-60 cursor-not-allowed",
                            )}
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {option.groupName}
                                </p>
                                <span className="text-[10px] text-muted-foreground font-number">
                                  {option.groupCode}
                                </span>
                                <SalesStatusBadge value={option.salesStatus} />
                              </div>
                              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-2">
                                <CalendarDays className="size-3" />
                                {formatDate(option.departureDate)} –{" "}
                                {formatDate(option.returnDate)} ·{" "}
                                {option.packageName}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p
                                className={cn(
                                  "text-xs font-number",
                                  blocked
                                    ? "text-destructive"
                                    : "text-foreground",
                                )}
                              >
                                {option.availableSeats} / {option.capacity} free
                              </p>
                              {blocked && (
                                <p className="text-[10px] text-destructive">
                                  Needs {booking.travellerCount}
                                </p>
                              )}
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {step === 2 && target && (
              <div className="flex flex-col gap-4 px-1">
                <Card className="flex-row shadow-xs rounded-sm py-4 flex items-center gap-2 text-xs">
                  <span className="font-number text-muted-foreground">
                    {booking.bookingReference}
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="text-foreground">
                    {target.groupName}{" "}
                    <span className="font-number text-muted-foreground">
                      ({target.groupCode})
                    </span>
                  </span>
                  {needsSeats && (
                    <span className="ml-auto font-number text-muted-foreground shrink-0">
                      {target.availableSeats} →{" "}
                      {target.availableSeats - booking.travellerCount} seats
                      free
                    </span>
                  )}
                </Card>

                {/* What the move rewrites, said plainly. */}
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {assignedRooms > 0 && (
                    <li>
                      {assignedRooms} room assignment
                      {assignedRooms === 1 ? "" : "s"} will be released — those
                      rooms belong to this group&apos;s hotels. Rebuild rooming
                      in {target.groupName}.
                    </li>
                  )}
                  <li>
                    Every traveller returns to <strong>Pending </strong> on
                    flights and needs re-ticketing on the new group&apos;s
                    flights.
                  </li>
                  <li>
                    Document requirements rebase onto {target.groupName}&apos;s
                    package snapshot; completed documents are kept.
                  </li>
                  {can.viewFinance && (
                    <li>
                      The payment due date moves to 14 days before{" "}
                      {formatDate(target.departureDate)}.
                    </li>
                  )}
                </ul>

                {can.viewFinance && (
                  <Card className="flex flex-col gap-3 shadow-xs rounded-sm   py-5">
                    {!rateAvailable ? (
                      <p className="text-[11px] text-muted-foreground">
                        {target.groupName} has no snapshot rate for{" "}
                        {ROOM_TYPE_LABELS[booking.roomOccupancyPreference]}{" "}
                        occupancy — the booking keeps its current rate.
                      </p>
                    ) : !canReprice ? (
                      <p className="text-[11px] text-muted-foreground">
                        {target.groupName} prices{" "}
                        {ROOM_TYPE_LABELS[booking.roomOccupancyPreference]} at{" "}
                        {formatExactCurrency(rate, currency)} per person. Your
                        role cannot change the price, so the booking keeps its
                        current rate.
                      </p>
                    ) : (
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <Checkbox
                          checked={reprice}
                          onCheckedChange={(checked) => {
                            setReprice(checked === true);
                            setError(null);
                          }}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="text-sm text-foreground">
                            Reprice at {target.groupName}&apos;s rate
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {formatExactCurrency(rate, currency)} per person for{" "}
                            {ROOM_TYPE_LABELS[booking.roomOccupancyPreference]}{" "}
                            occupancy.
                          </span>
                        </span>
                      </label>
                    )}

                    {willReprice && (
                      <div className="flex flex-col gap-1.5">
                        <InputGroup>
                          <InputGroupAddon align={"block-start"}>
                            <InputGroupText>
                              {" "}
                              Package price / person
                            </InputGroupText>
                          </InputGroupAddon>
                          <CurrencyInput
                            value={parseInt(priceOverride ?? "") ?? rate}
                            onValueChange={(val) => {
                              setPriceOverride(String(val));
                              setError(null);
                            }}
                            className="font-number"
                          />
                        </InputGroup>
                      </div>
                    )}

                    <div className="flex flex-col gap-1 text-xs mt-3">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          Total booking value
                        </span>
                        <span className="font-number text-foreground">
                          {formatExactCurrency(
                            booking.totalBookingValue,
                            currency,
                          )}
                          {newTotal !== booking.totalBookingValue && (
                            <> → {formatExactCurrency(newTotal, currency)}</>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          Amount paid
                        </span>
                        <span className={`font-number ${TONE_TEXT.success}`}>
                          {formatExactCurrency(booking.amountPaid, currency)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground">
                          Outstanding balance
                        </span>
                        <span
                          className={cn(
                            "font-number",
                            newOutstanding > 0
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {formatExactCurrency(
                            booking.outstandingBalance,
                            currency,
                          )}
                          {newOutstanding !== booking.outstandingBalance && (
                            <>
                              {" "}
                              → {formatExactCurrency(newOutstanding, currency)}
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </Card>
                )}

                <label className="flex items-start gap-2.5 cursor-pointer mt-2">
                  <Checkbox
                    checked={reissueReference}
                    onCheckedChange={(checked) =>
                      setReissueReference(checked === true)
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-sm text-foreground">
                      Reissue the booking reference as {target.groupCode}-BK…
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      Leave this off to keep {booking.bookingReference}, which
                      the pilgrim&apos;s existing paperwork already quotes.
                    </span>
                  </span>
                </label>

                <div className="pb-10">
                  <InputGroup>
                    <InputGroupAddon align={"block-start"}>
                      <InputGroupText> Reason (optional)</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupTextarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Why the booking is moving — goes on both groups' activity trails…"
                      rows={2}
                    />
                  </InputGroup>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-sm bg-destructive/10 mx-5  py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between flex-row">
          <div className="w-full">
            {step === 2 && (
              <Button
                variant="ghost"
                onClick={() => {
                  setStep(1);
                  setError(null);
                }}
              >
                <ArrowLeft className="size-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {step === 2 && (
              <Button
                disabled={isPending || !booking || !target || belowCollected}
                onClick={submit}
              >
                {isPending && <Loader2 className="animate-spin" />}
                Move Booking
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function StepChip({
  index,
  label,
  active,
  done,
  onClick,
}: {
  index: number;
  label: string;
  active: boolean;
  done: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn("flex items-center gap-2", done && "cursor-pointer")}
      onClick={done ? onClick : undefined}
    >
      <span
        className={cn(
          "size-5 rounded-full text-[10px] font-semibold flex items-center justify-center",
          active
            ? "bg-primary text-white"
            : done
              ? TONE_CLASS.success
              : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3" /> : index}
      </span>
      <span
        className={cn(
          "text-xs",
          active ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}

export default MoveBookingDialog;
