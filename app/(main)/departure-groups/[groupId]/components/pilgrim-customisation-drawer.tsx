"use client";

import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  ROLE_LABELS,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  Loader2,
  Plus,
  Wrench,
  X,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState, useTransition } from "react";

import {
  addPilgrimChargeAction,
  approvePilgrimChargeAction,
  cancelPilgrimDeviationAction,
  decidePilgrimDeviationAction,
  markDeviationArrangedAction,
  setPilgrimRoomTypeAction,
  voidPilgrimChargeAction,
} from "../../actions";
import SectionHeading from "@/components/section-heading";
import type {
  ChargeType,
  DepartureGroupAccommodation,
  DepartureGroupFlight,
  DepartureGroupManifestRow,
  DepartureGroupPackageSnapshot,
  DepartureGroupTransport,
  PilgrimCharge,
  PilgrimDeviation,
  RoomType,
  ServiceAddon,
} from "../../types";
import { ROOM_TYPE_LABELS, formatDate, formatExactCurrency } from "../../utils";

import DeviationDetailView from "./customisation/deviation-detail-view";
import RequestDeviationForm from "./customisation/request-deviation-dialog";
import { DEVIATION_BY_TYPE } from "./customisation/deviation-registry";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";

interface PilgrimCustomisationDrawerProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  role: StaffRole;
  open: boolean;
  onClose: () => void;
  flights: DepartureGroupFlight[];
  accommodations: DepartureGroupAccommodation[];
  transports: DepartureGroupTransport[];
  itinerary: DepartureGroupPackageSnapshot["itinerary"];
  groupTravellers: { id: string; name: string }[];
  addons: ServiceAddon[];
}

type View = "detail" | "add";

const CHARGE_TYPE_LABELS: Record<ChargeType, string> = {
  BASE_FARE: "Base fare",
  ROOM_UPGRADE: "Room upgrade",
  EXTRA_NIGHTS: "Extra nights",
  FLIGHT_VARIATION: "Flight variation",
  TRANSPORT_VARIATION: "Transport variation",
  ADDON: "Add-on",
  DISCOUNT: "Discount",
  SURCHARGE: "Surcharge",
  PRICE_CORRECTION: "Price correction",
  CANCELLATION_FEE: "Cancellation fee",
};

const ADDABLE_CHARGE_TYPES = Object.keys(CHARGE_TYPE_LABELS).filter(
  (t) => t !== "BASE_FARE",
) as Exclude<ChargeType, "BASE_FARE">[];

const DEVIATION_STATUS_STYLE: Record<PilgrimDeviation["status"], string> = {
  REQUESTED: TONE_CLASS.warning,
  APPROVED: TONE_CLASS.info,
  ARRANGED: TONE_CLASS.success,
  DECLINED: TONE_CLASS.danger,
  CANCELLED: TONE_CLASS.neutral,
};

const PilgrimCustomisationDrawer = ({
  row,
  departureGroupId,
  role,
  open,
  onClose,
  flights,
  accommodations,
  transports,
  itinerary,
  groupTravellers,
  addons,
}: PilgrimCustomisationDrawerProps) => {
  const can = useDepartureCapabilities(role);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [view, setView] = useState<View>("detail");

  const [chargeFormOpen, setChargeFormOpen] = useState(false);
  const [chargeType, setChargeType] = useState<Exclude<ChargeType, "BASE_FARE">>("ADDON");
  const [chargeLabel, setChargeLabel] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeReason, setChargeReason] = useState("");

  const [decidingDeviation, setDecidingDeviation] = useState<PilgrimDeviation | null>(null);
  const [decisionApprove, setDecisionApprove] = useState(true);
  const [decisionNote, setDecisionNote] = useState("");

  const [voidingCharge, setVoidingCharge] = useState<PilgrimCharge | null>(null);
  const [voidReason, setVoidReason] = useState("");

  useResetOnOpen(open, row?.id ?? "", () => {
    setBusyId(null);
    setView("detail");
    setChargeFormOpen(false);
    setChargeType("ADDON");
    setChargeLabel("");
    setChargeAmount("");
    setChargeReason("");
    setDecidingDeviation(null);
    setDecisionNote("");
    setVoidingCharge(null);
    setVoidReason("");
  });

  const run = (
    id: string,
    work: () => Promise<{ ok: true } | { ok: false; error: string }>,
    successTitle: string,
    onSuccess?: () => void,
  ) => {
    setBusyId(id);
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          toast.add({ title: "Could not update", description: result.error });
          return;
        }
        toast.add({ title: successTitle, description: row?.fullName });
        onSuccess?.();
        router.refresh();
      } catch {
        toast.add({
          title: "Could not update",
          description: "The change did not reach the server. Try again.",
        });
      } finally {
        setBusyId(null);
      }
    });
  };

  const submitCharge = () => {
    if (!row) return;
    const amount = Number(chargeAmount);
    run(
      "add-charge",
      () =>
        addPilgrimChargeAction({
          departureGroupId,
          groupPilgrimId: row.id,
          chargeType,
          label: chargeLabel,
          amount: chargeType === "DISCOUNT" ? -Math.abs(amount) : Math.abs(amount),
          reason: chargeReason || undefined,
        }),
      "Charge added",
      () => {
        setChargeFormOpen(false);
        setChargeLabel("");
        setChargeAmount("");
        setChargeReason("");
      },
    );
  };

  const confirmVoid = () => {
    if (!voidingCharge) return;
    run(
      voidingCharge.id,
      () =>
        voidPilgrimChargeAction({
          departureGroupId,
          chargeId: voidingCharge.id,
          reason: voidReason,
        }),
      "Charge voided",
      () => {
        setVoidingCharge(null);
        setVoidReason("");
      },
    );
  };

  const confirmDecision = () => {
    if (!decidingDeviation) return;
    run(
      decidingDeviation.id,
      () =>
        decidePilgrimDeviationAction({
          departureGroupId,
          deviationId: decidingDeviation.id,
          approve: decisionApprove,
          note: decisionNote || undefined,
        }),
      decisionApprove ? "Deviation approved" : "Deviation declined",
      () => {
        setDecidingDeviation(null);
        setDecisionNote("");
      },
    );
  };

  const changeRoomType = (type: RoomType) => {
    if (!row) return;
    run(
      "room-type",
      () =>
        setPilgrimRoomTypeAction({
          departureGroupId,
          groupPilgrimId: row.id,
          roomOccupancyType: type,
        }),
      "Occupancy updated",
    );
  };

  if (!row) return null;

  const liveCharges = row.charges.filter((c) => !c.voidedAt);
  const voidedCharges = row.charges.filter((c) => c.voidedAt);

  const deviationCounts = row.deviations.reduce(
    (acc, d) => {
      const entry = DEVIATION_BY_TYPE[d.deviationType];
      if (entry) acc[entry.family] = (acc[entry.family] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent side="right" className="sm:max-w-2xl! w-full" showCloseButton={view === "detail"}>
          <SheetHeader>
            {view === "add" ? (
              <>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon-sm" onClick={() => setView("detail")}>
                    <ArrowLeft className="size-4" />
                  </Button>
                  <SheetTitle className="text-lg!">Add customisation</SheetTitle>
                </div>
                <SheetDescription>{row.fullName}</SheetDescription>
              </>
            ) : (
              <>
                <SheetTitle className="flex items-center gap-2.5 text-lg!">
                  {row.fullName}
                  {row.hasCustomisations && (
                    <Badge className="bg-primary/10 text-primary text-[10px]">
                      <Wrench className="size-3" /> Customised
                    </Badge>
                  )}
                </SheetTitle>
                <SheetDescription>
                  {row.bookingReference} ·{" "}
                  {row.totalPrice !== null
                    ? `${formatExactCurrency(row.totalPrice)} total`
                    : "Pricing hidden for your role"}
                </SheetDescription>
              </>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto custom-scroll px-4 pb-4">
            {view === "add" ? (
              <RequestDeviationForm
                pilgrim={row}
                departureGroupId={departureGroupId}
                flights={flights}
                accommodations={accommodations}
                transports={transports}
                itinerary={itinerary}
                groupTravellers={groupTravellers}
                addons={addons}
                onClose={() => setView("detail")}
              />
            ) : (
              <div className="flex flex-col gap-4">
                {/* ── Customisation summary strip ──────────────────────── */}
                {row.deviations.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(deviationCounts).map(([fam, count]) => (
                      <span
                        key={fam}
                        className="text-[11px] text-muted-foreground bg-muted/50 rounded-md px-2 py-0.5"
                      >
                        {fam.charAt(0).toUpperCase() + fam.slice(1)}: {count}
                      </span>
                    ))}
                  </div>
                )}

                {/* ── Occupancy ─────────────────────────────────────────── */}
                {can.manageRooming && (
                  <Card className="min-h-fit bg-transparent flex flex-col gap-3">
                    <SectionHeading title="Room occupancy" />
                    <div className="grid grid-cols-5 gap-2">
                      {(["QUAD", "TRIPLE", "DOUBLE", "SINGLE", "OTHER"] as RoomType[]).map(
                        (type) => {
                          const active = row.roomOccupancyType === type;
                          return (
                            <button
                              key={type}
                              type="button"
                              disabled={isPending}
                              onClick={() => changeRoomType(type)}
                              className={cn(
                                "rounded-md border px-2 py-1.5 text-xs transition-colors",
                                active
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border/50 hover:bg-muted/50 text-foreground",
                              )}
                            >
                              {ROOM_TYPE_LABELS[type]}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </Card>
                )}

                {/* ── Price breakdown ───────────────────────────────────── */}
                {can.viewPilgrimPricing && (
                  <Card className="min-h-fit bg-transparent flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <SectionHeading title="Price breakdown" />
                      {can.manageTravellerCustomisations && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setChargeFormOpen((v) => !v)}
                        >
                          <Plus className="size-3.5" /> Add charge
                        </Button>
                      )}
                    </div>

                    {chargeFormOpen && (
                      <div className="flex flex-col gap-2 rounded-md border border-border/40 p-3">
                        <div className="grid grid-cols-2 gap-2">
                          <Select
                            value={chargeType}
                            onValueChange={(value) =>
                              setChargeType(value as Exclude<ChargeType, "BASE_FARE">)
                            }
                          >
                            <SelectTrigger className="w-full text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ADDABLE_CHARGE_TYPES.map((t) => (
                                <SelectItem key={t} value={t} className="text-xs">
                                  {CHARGE_TYPE_LABELS[t]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            placeholder="Amount (LKR)"
                            value={chargeAmount}
                            onChange={(e) => setChargeAmount(e.target.value)}
                          />
                        </div>
                        <Input
                          placeholder="Label — e.g. Single room upgrade"
                          value={chargeLabel}
                          onChange={(e) => setChargeLabel(e.target.value)}
                        />
                        <Textarea
                          rows={2}
                          placeholder={
                            chargeType === "DISCOUNT" || chargeType === "PRICE_CORRECTION"
                              ? "Reason — required for approval"
                              : "Reason (optional)"
                          }
                          value={chargeReason}
                          onChange={(e) => setChargeReason(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setChargeFormOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={submitCharge}
                            disabled={
                              isPending ||
                              !chargeLabel.trim() ||
                              !chargeAmount ||
                              Number(chargeAmount) === 0
                            }
                          >
                            {isPending && busyId === "add-charge" && (
                              <Loader2 className="animate-spin" />
                            )}
                            Add charge
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col divide-y divide-border/20">
                      {liveCharges.map((charge) => (
                        <div
                          key={charge.id}
                          className="flex items-center justify-between gap-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-foreground truncate">
                              {charge.label}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {CHARGE_TYPE_LABELS[charge.chargeType]}
                              {charge.pricedRoomType
                                ? ` · ${ROOM_TYPE_LABELS[charge.pricedRoomType]}`
                                : ""}
                              {charge.requiresApproval && !charge.approvedAt && (
                                <span className={TONE_TEXT.warning}>
                                  {" "}
                                  · awaiting approval
                                </span>
                              )}
                              {charge.approvedAt && (
                                <span> · approved by {charge.approvedByName}</span>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={cn(
                                "text-sm font-number",
                                charge.amount < 0
                                  ? TONE_TEXT.success
                                  : "text-foreground",
                              )}
                            >
                              {charge.amount < 0 ? "-" : ""}
                              {formatExactCurrency(Math.abs(charge.amount) * charge.quantity)}
                            </span>
                            {can.approveDiscounts &&
                              charge.requiresApproval &&
                              !charge.approvedAt && (
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  title="Approve"
                                  disabled={isPending}
                                  onClick={() =>
                                    run(
                                      charge.id,
                                      () =>
                                        approvePilgrimChargeAction({
                                          departureGroupId,
                                          chargeId: charge.id,
                                        }),
                                      "Charge approved",
                                    )
                                  }
                                >
                                  <Check className="size-3.5" />
                                </Button>
                              )}
                            {can.manageTravellerCustomisations &&
                              charge.chargeType !== "BASE_FARE" && (
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  title="Void"
                                  disabled={isPending}
                                  onClick={() => setVoidingCharge(charge)}
                                >
                                  <X className="size-3.5" />
                                </Button>
                              )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {voidedCharges.length > 0 && (
                      <details className="text-[11px] text-muted-foreground">
                        <summary className="cursor-pointer">
                          {voidedCharges.length} voided line
                          {voidedCharges.length === 1 ? "" : "s"}
                        </summary>
                        <div className="flex flex-col gap-1 mt-1">
                          {voidedCharges.map((c) => (
                            <p key={c.id} className="line-through">
                              {c.label} — {formatExactCurrency(Math.abs(c.amount))} ·{" "}
                              {c.voidReason}
                            </p>
                          ))}
                        </div>
                      </details>
                    )}

                    <div className="flex items-center justify-between border-t border-border/40 pt-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        Total
                      </span>
                      <span className="text-sm font-semibold text-foreground font-number">
                        {formatExactCurrency(row.totalPrice ?? 0)}
                      </span>
                    </div>
                  </Card>
                )}

                {/* ── Deviations ────────────────────────────────────────── */}
                <Card className="min-h-fit bg-transparent flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <SectionHeading title="Customisations" />
                    {can.manageTravellerCustomisations && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setView("add")}
                      >
                        <Plus className="size-3.5" /> Add customisation
                      </Button>
                    )}
                  </div>

                  {row.deviations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No customisations for this traveller. Everything follows the
                      group standard.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {row.deviations.map((deviation) => (
                        <div
                          key={deviation.id}
                          className="flex items-start justify-between gap-3 rounded-md border border-border/40 px-3 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm text-foreground">{deviation.summary}</p>
                              {deviation.blocksDeparture && (
                                <AlertTriangle className={`size-3.5 ${TONE_TEXT.warning} shrink-0`} />
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {DEVIATION_BY_TYPE[deviation.deviationType]?.label ?? deviation.deviationType} · owned by{" "}
                              {ROLE_LABELS[deviation.responsibleRole as StaffRole] ??
                                deviation.responsibleRole}{" "}
                              · requested by {deviation.requestedByName} on{" "}
                              {formatDate(deviation.requestedAt)}
                            </p>
                            {deviation.decisionNote && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {deviation.status === "DECLINED" ? "Declined: " : "Note: "}
                                {deviation.decisionNote}
                              </p>
                            )}
                            <DeviationDetailView deviation={deviation} />
                            {deviation.chargeId && can.viewPilgrimPricing && (() => {
                              const linkedCharge = row.charges.find(
                                (c) => c.id === deviation.chargeId && !c.voidedAt,
                              );
                              return linkedCharge ? (
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  ↳ {formatExactCurrency(Math.abs(linkedCharge.amount) * linkedCharge.quantity)} — {linkedCharge.label}
                                </p>
                              ) : null;
                            })()}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge
                              className={cn(
                                "text-[10px]",
                                DEVIATION_STATUS_STYLE[deviation.status],
                              )}
                            >
                              {deviation.status}
                            </Badge>
                            {deviation.status === "REQUESTED" &&
                              (can.manageTravellerCustomisations || can.approveDiscounts) && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    title="Approve"
                                    disabled={isPending}
                                    onClick={() => {
                                      setDecidingDeviation(deviation);
                                      setDecisionApprove(true);
                                      setDecisionNote("");
                                    }}
                                  >
                                    <Check className="size-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    title="Decline"
                                    disabled={isPending}
                                    onClick={() => {
                                      setDecidingDeviation(deviation);
                                      setDecisionApprove(false);
                                      setDecisionNote("");
                                    }}
                                  >
                                    <X className="size-3.5" />
                                  </Button>
                                </>
                              )}
                            {deviation.status === "APPROVED" &&
                              can.manageTravellerCustomisations && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    title="Mark arranged"
                                    disabled={isPending}
                                    onClick={() =>
                                      run(
                                        deviation.id,
                                        () =>
                                          markDeviationArrangedAction({
                                            departureGroupId,
                                            deviationId: deviation.id,
                                          }),
                                        "Deviation arranged",
                                      )
                                    }
                                  >
                                    <Check className="size-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    title="Cancel"
                                    disabled={isPending}
                                    onClick={() =>
                                      run(
                                        deviation.id,
                                        () =>
                                          cancelPilgrimDeviationAction({
                                            departureGroupId,
                                            deviationId: deviation.id,
                                            reason: "Cancelled by staff",
                                          }),
                                        "Deviation cancelled",
                                      )
                                    }
                                  >
                                    <Ban className="size-3.5" />
                                  </Button>
                                </>
                              )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Void charge confirmation ───────────────────────────────────── */}
      <Dialog
        open={voidingCharge !== null}
        onOpenChange={(next) => {
          if (!next) {
            setVoidingCharge(null);
            setVoidReason("");
          }
        }}
      >
        <DialogContent className="max-w-md!">
          <DialogHeader>
            <DialogTitle>Void charge</DialogTitle>
            <DialogDescription>{voidingCharge?.label}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={3}
            placeholder="Why is this charge being removed?"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setVoidingCharge(null);
                setVoidReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={confirmVoid}
              disabled={voidReason.trim().length < 3 || isPending}
            >
              {isPending && <Loader2 className="animate-spin" />}
              Void
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Deviation decision confirmation ────────────────────────────── */}
      <Dialog
        open={decidingDeviation !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDecidingDeviation(null);
            setDecisionNote("");
          }
        }}
      >
        <DialogContent className="max-w-md!">
          <DialogHeader>
            <DialogTitle>{decisionApprove ? "Approve" : "Decline"} deviation</DialogTitle>
            <DialogDescription>{decidingDeviation?.summary}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            rows={3}
            placeholder={decisionApprove ? "Note (optional)" : "Why is this declined?"}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDecidingDeviation(null);
                setDecisionNote("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant={decisionApprove ? "default" : "destructive"}
              onClick={confirmDecision}
              disabled={
                isPending || (!decisionApprove && decisionNote.trim().length < 3)
              }
            >
              {isPending && <Loader2 className="animate-spin" />}
              {decisionApprove ? "Approve" : "Decline"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PilgrimCustomisationDrawer;
