"use client";

import { Button } from "@/components/ui/button";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import { changeRoomPreferenceSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { BedDouble, Loader2, TriangleAlert } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useMemo, useState, useTransition } from "react";

import { changeRoomPreferenceAction } from "../../actions";
import type {
  DepartureGroupBooking,
  DepartureGroupManifestRow,
  DepartureGroupPricing,
  RoomType,
} from "../../types";
import { ROOM_TYPE_LABELS, formatExactCurrency } from "../../utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { Card } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

interface ChangeRoomPreferenceDialogProps {
  booking: DepartureGroupBooking | null;
  /** Travellers on this booking (manifest rows filtered by booking id). */
  travellers: DepartureGroupManifestRow[];
  pricing: DepartureGroupPricing;
  role: StaffRole;
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const TIERS: RoomType[] = ["QUAD", "TRIPLE", "DOUBLE", "SINGLE"];

/**
 * Changes a booking's room occupancy tier.
 *
 * The preference is a booking-level field, so this is deliberately framed as a
 * change for everyone on the booking rather than for the one pilgrim whose row
 * was clicked. Two consequences are surfaced before the operator commits:
 *
 *   * the money — a tier has its own current rate, so switching tiers offers a
 *     reprice and shows the resulting total and balance (finance roles only;
 *     only a pricing role may actually apply it), and
 *   * the rooming — assignments made for the old occupancy go stale, so they can
 *     be released in the same step and rebuilt in Hotels & Rooms.
 */
const ChangeRoomPreferenceDialog = ({
  booking,
  travellers,
  pricing,
  role,
  open,
  onClose,
  embedded = false,
}: ChangeRoomPreferenceDialogProps) => {
  const can = useDepartureCapabilities(role);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const current = booking?.roomOccupancyPreference ?? "QUAD";
  const [preference, setPreference] = useState<RoomType>(current);
  const [reprice, setReprice] = useState(false);
  const [price, setPrice] = useState(
    String(booking?.packagePricePerPerson ?? 0),
  );
  const [releaseRooms, setReleaseRooms] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between opens (so it can animate), so the form
  // has to re-sync from `booking` each time it opens rather than only on
  // first mount.
  useResetOnOpen(open, booking?.id ?? "", () => {
    setPreference(booking?.roomOccupancyPreference ?? "QUAD");
    setReprice(false);
    setPrice(String(booking?.packagePricePerPerson ?? 0));
    setReleaseRooms(true);
    setNote("");
    setError(null);
  });

  const priceByTier = useMemo(
    () =>
      ({
        QUAD: pricing.quadPrice,
        TRIPLE: pricing.triplePrice,
        DOUBLE: pricing.doublePrice,
        SINGLE: pricing.singlePrice,
        OTHER: null,
      }) as Record<RoomType, number | null>,
    [pricing],
  );

  const currency = pricing.currency || "LKR";
  const assigned = travellers.filter((t) => t.roomId);
  const lockedCount = travellers.filter(
    (t) => t.roomAssignmentStatus === "LOCKED",
  ).length;
  const releasableCount = assigned.length - lockedCount;

  // A tier the group never priced (OTHER, or a tier missing from the current pricing)
  // stays selectable, it just cannot suggest a rate.
  const tiers = TIERS.includes(current) ? TIERS : [...TIERS, current];

  const parsedPrice = Math.max(0, Math.round(Number(price) || 0));
  const willReprice = reprice && can.overrideCapacityAndPrice;
  const effectivePrice = willReprice
    ? parsedPrice
    : (booking?.packagePricePerPerson ?? 0);
  const newTotal = effectivePrice * (booking?.travellerCount ?? 0);
  const newOutstanding = Math.max(newTotal - (booking?.amountPaid ?? 0), 0);
  const belowCollected = newTotal < (booking?.amountPaid ?? 0);

  const priceChanged =
    willReprice && parsedPrice !== (booking?.packagePricePerPerson ?? 0);
  const tierChanged = preference !== booking?.roomOccupancyPreference;
  const hasChange = tierChanged || priceChanged;

  /** Picking a tier re-prices to that tier's current rate, as Add Booking does. */
  const chooseTier = (tier: RoomType) => {
    setPreference(tier);
    setError(null);

    if (tier === booking?.roomOccupancyPreference) {
      setPrice(String(booking?.packagePricePerPerson ?? 0));
      setReprice(false);
      return;
    }

    const tierPrice = priceByTier[tier];
    if (tierPrice !== null && tierPrice !== undefined) {
      setPrice(String(tierPrice));
      setReprice(tierPrice !== (booking?.packagePricePerPerson ?? 0));
    }
  };

  const submit = () => {
    setError(null);

    if (!booking) return;

    if (!hasChange) {
      setError("Pick a different occupancy tier, or change the rate.");
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
      departureGroupId: booking.departureGroupId,
      roomOccupancyPreference: preference,
      pricePerPerson: willReprice ? parsedPrice : undefined,
      releaseRoomAssignments: releaseRooms && releasableCount > 0,
      note: note.trim() || undefined,
    };

    const check = changeRoomPreferenceSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That change is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await changeRoomPreferenceAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const parts = [
        `${result.bookingReference}: ${
          ROOM_TYPE_LABELS[result.previousPreference]
        } → ${ROOM_TYPE_LABELS[result.roomOccupancyPreference]} for ${
          result.travellerCount
        } traveller${result.travellerCount === 1 ? "" : "s"}.`,
      ];
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
      if (result.releasedRoomAssignments > 0) {
        parts.push(
          `${result.releasedRoomAssignments} room assignment${
            result.releasedRoomAssignments === 1 ? "" : "s"
          } released — rebuild rooming in Hotels & Rooms.`,
        );
      }
      if (result.lockedRoomAssignments > 0) {
        parts.push(
          `${result.lockedRoomAssignments} locked assignment${
            result.lockedRoomAssignments === 1 ? "" : "s"
          } kept.`,
        );
      }

      toast.add({
        title: "Room preference updated",
        description: parts.join(" "),
      });
      onClose();
      router.refresh();
    });
  };

  const body = (
    <>
      <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto custom-scroll">
        <p className="text-xs text-muted-foreground">
          Occupancy is set on the booking, so this applies to everyone on it —
          not just the pilgrim you opened this from. Currently{" "}
          <strong className="text-foreground">
            {booking && ROOM_TYPE_LABELS[booking.roomOccupancyPreference]}
          </strong>
          .
        </p>

        <div className="grid grid-cols-2 gap-3">
          {tiers.map((tier) => {
            const tierPrice = priceByTier[tier];
            const isCurrent = tier === booking?.roomOccupancyPreference;
            const isSelected = tier === preference;
            return (
              <Card
                key={tier}
                onClick={() => chooseTier(tier)}
                aria-pressed={isSelected}
                className={cn(
                  "flex items-start justify-between gap-2 shadow-sm flex-row  rounded-sm px-3 py-2.5 text-left transition-colors",
                  isSelected
                    ? "border-primary/10 bg-primary/10!"
                    : " hover:bg-muted/50",
                )}
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium text-foreground",
                      isSelected && "text-primary",
                    )}
                  >
                    {ROOM_TYPE_LABELS[tier]}
                  </p>
                  {can.viewFinance && (
                    <p className="text-[11px] text-muted-foreground font-number">
                      {tierPrice !== null && tierPrice !== undefined
                        ? `${formatExactCurrency(tierPrice, currency)} / person`
                        : "No price set"}
                    </p>
                  )}
                </div>
                {isCurrent && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    Current
                  </span>
                )}
              </Card>
            );
          })}
        </div>

        {can.viewFinance && (
          <Card className="flex flex-col gap-3 border border-border/50 shadow-sm min-h-fit px-5 py-5">
            {can.overrideCapacityAndPrice ? (
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
                    Reprice this booking at the new rate
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Updates the total, the outstanding balance and every
                    traveller&apos;s payment status.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Your role cannot change the package price — the booking keeps
                its current rate and finance can reprice it.
              </p>
            )}

            {willReprice && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground"></span>
                <InputGroup>
                  <InputGroupAddon align={"block-start"}>
                    <InputGroupText> Package price / person</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={price}
                    onChange={(e) => {
                      setPrice(e.target.value);
                      setError(null);
                    }}
                    className="font-number"
                  />
                </InputGroup>
              </div>
            )}

            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">
                  Total booking value
                </span>
                <span className="font-number text-foreground">
                  {formatExactCurrency(
                    booking?.totalBookingValue ?? 0,
                    currency,
                  )}
                  {newTotal !== (booking?.totalBookingValue ?? 0) && (
                    <> → {formatExactCurrency(newTotal, currency)}</>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Amount paid</span>
                <span className={`font-number ${TONE_TEXT.success}`}>
                  {formatExactCurrency(booking?.amountPaid ?? 0, currency)}
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
                    booking?.outstandingBalance ?? 0,
                    currency,
                  )}
                  {newOutstanding !== (booking?.outstandingBalance ?? 0) && (
                    <> → {formatExactCurrency(newOutstanding, currency)}</>
                  )}
                </span>
              </div>
            </div>
          </Card>
        )}

        {assigned.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-border/50 px-3 py-3">
            <p className="flex items-center gap-2 text-xs text-foreground">
              <BedDouble className="size-3.5 text-muted-foreground shrink-0" />
              {assigned.length} of {booking?.travellerCount} traveller
              {booking?.travellerCount === 1 ? " is" : "s are"} already in a
              room.
            </p>
            {releasableCount > 0 ? (
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox
                  checked={releaseRooms}
                  onCheckedChange={(checked) =>
                    setReleaseRooms(checked === true)
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="text-sm text-foreground">
                    Release {releasableCount} room assignment
                    {releasableCount === 1 ? "" : "s"}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Rooms booked for the old occupancy no longer fit. Rebuild
                    rooming in Hotels &amp; Rooms afterwards.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Every assignment is locked, so rooming is left untouched.
              </p>
            )}
            {lockedCount > 0 && releasableCount > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {lockedCount} locked assignment
                {lockedCount === 1 ? " is" : "s are"} kept regardless.
              </p>
            )}
          </div>
        )}

        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText> Reason (optional)</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why the occupancy changed — goes on the activity trail…"
            rows={2}
          />
        </InputGroup>

        {error && (
          <Card className="flex flex-row items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </Card>
        )}
      </div>

      <DialogFooter
        className={cn(
          "shrink-0",
          embedded && "mx-0 mb-0 border-t border-border/60 px-0 pt-3 pb-0",
        )}
      >
        <Button
          variant="ghost"
          onClick={onClose}
          disabled={isPending}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          disabled={isPending || !booking || !hasChange || belowCollected}
          onClick={submit}
          className="w-full sm:w-auto"
        >
          {isPending && <Loader2 className="animate-spin" />}
          Save Preference
        </Button>
      </DialogFooter>
    </>
  );

  if (embedded) return body;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-3xl p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Change Room Preference</DialogTitle>
          <DialogDescription>
            {booking?.bookingReference} · {booking?.primaryContactName} ·{" "}
            {booking?.travellerCount} traveller
            {booking?.travellerCount === 1 ? "" : "s"}
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 pb-5">{body}</div>
      </DialogContent>
    </Dialog>
  );
};

export default ChangeRoomPreferenceDialog;
