"use client";

import { Badge } from "@/components/ui/badge";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import { ArrowRight, Lock } from "lucide-react";
import React from "react";

import type {
  DepartureGroupAccommodation,
  DepartureGroupListItem,
  DepartureGroupPackageSnapshot,
  DepartureGroupPricing,
  DepartureGroupReadinessItem,
  DepartureGroupTransport,
} from "../../types";
import { formatDate, formatExactCurrency } from "../../utils";
import { TONE_TEXT } from "@/lib/ui/tone";

interface TemplateComparisonDialogProps {
  group: DepartureGroupListItem;
  snapshot: DepartureGroupPackageSnapshot;
  /** The group's CURRENT price — compared against `snapshot`'s frozen one below. */
  pricing: DepartureGroupPricing;
  accommodations: DepartureGroupAccommodation[];
  transports: DepartureGroupTransport[];
  readinessItems: DepartureGroupReadinessItem[];
  role: StaffRole;
  open: boolean;
  onClose: () => void;
}

function Line({
  label,
  frozen,
  live,
  drifted,
}: {
  label: string;
  frozen: React.ReactNode;
  live: React.ReactNode;
  drifted?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground truncate">{frozen}</p>
      </div>
      <ArrowRight
        className={cn(
          "size-3.5 shrink-0",
          drifted ? TONE_TEXT.warning : "text-border",
        )}
      />
      <div className="min-w-0 text-right">
        <p className="text-[11px] text-muted-foreground">In this group</p>
        <p
          className={cn(
            "text-sm truncate",
            drifted
              ? `${TONE_TEXT.warning} font-medium`
              : "text-foreground",
          )}
        >
          {live}
        </p>
      </div>
    </div>
  );
}

/**
 * Shows what this group was copied from, next to what it has become.
 *
 * There is deliberately no "apply template updates" here. The snapshot is the
 * commercial record of what each pilgrim bought — inclusions, prices, itinerary
 * — and overwriting it from a template edited months later would rewrite the
 * terms of bookings that are already sold. Drift is information for the
 * operator, not something to silently reconcile; anything that genuinely needs
 * changing is changed on the group itself, where it lands on the activity trail.
 */
const TemplateComparisonDialog = ({
  group,
  snapshot,
  pricing,
  accommodations,
  transports,
  readinessItems,
  role,
  open,
  onClose,
}: TemplateComparisonDialogProps) => {
  const can = useDepartureCapabilities(role);

  const confirmedHotels = accommodations.filter(
    (a) => a.status === "CONFIRMED" || a.status === "COMPLETED",
  ).length;
  const confirmedTransport = transports.filter(
    (t) => t.status === "CONFIRMED" || t.status === "COMPLETED",
  ).length;
  const completedReadiness = readinessItems.filter(
    (item) => item.status === "COMPLETE",
  ).length;

  const nights = accommodations.reduce((sum, a) => sum + a.nights, 0);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl! max-h-[85vh] overflow-y-auto custom-scroll">
        <DialogHeader>
          <DialogTitle>Compare with Package Template</DialogTitle>
          <DialogDescription>
            {snapshot.packageName} ({snapshot.packageCode}) · frozen{" "}
            {formatDate(snapshot.copiedAt)}
          </DialogDescription>
        </DialogHeader>

        <Card className="flex-row items-start gap-2 rounded-sm bg-muted/40 px-3 py-2.5 shadow-none">
          <Lock className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground">
            The snapshot on the left is what this group&apos;s pilgrims bought.
            It never changes when the Package Template is edited, so this view is
            a record of drift — not something to sync. Change the group itself if
            a figure is wrong.
          </p>
        </Card>

        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-medium text-foreground mb-1">
              Commercial terms
            </p>
            <div className="divide-y divide-border/30">
              <Line
                label="Package"
                frozen={snapshot.packageName || "—"}
                // Fetched fresh from the live `packages` row — never read
                // off the snapshot the way `group.packageTemplateName`
                // itself is (that value is only ever the frozen name, so
                // comparing the snapshot to it can never show real drift;
                // this used to be exactly that bug — see finding C8 in
                // docs/modules/packages-production-readiness-plan.md).
                live={
                  snapshot.livePackageTitle === null
                    ? "Template no longer available"
                    : snapshot.livePackageTitle
                }
                drifted={
                  Boolean(snapshot.packageName) &&
                  snapshot.livePackageTitle !== null &&
                  snapshot.packageName !== snapshot.livePackageTitle
                }
              />
              {snapshot.packageVersionId &&
                snapshot.livePackagePublishedVersionId &&
                snapshot.packageVersionId !== snapshot.livePackagePublishedVersionId && (
                  <p className={`text-[11px] ${TONE_TEXT.warning} py-1`}>
                    The template has been republished since this group was
                    created — its content may no longer match what this
                    group&apos;s pilgrims actually booked. The frozen record
                    on the left is still what governs this group.
                  </p>
                )}
              {can.viewFinance && (
                <>
                  <Line
                    label="Quad price"
                    frozen={
                      snapshot.quadPrice === null
                        ? "Not priced"
                        : formatExactCurrency(
                            snapshot.quadPrice,
                            snapshot.currency,
                          )
                    }
                    live={
                      pricing.quadPrice === null
                        ? "Not priced"
                        : formatExactCurrency(pricing.quadPrice, pricing.currency)
                    }
                    drifted={pricing.priceSource === "OVERRIDDEN"}
                  />
                  <Line
                    label="Advance deposit"
                    frozen={
                      snapshot.advanceDeposit === null
                        ? "Not set"
                        : formatExactCurrency(
                            snapshot.advanceDeposit,
                            snapshot.currency,
                          )
                    }
                    live={
                      pricing.advanceDeposit === null
                        ? "Not set"
                        : formatExactCurrency(
                            pricing.advanceDeposit,
                            pricing.currency,
                          )
                    }
                    drifted={
                      pricing.priceSource === "OVERRIDDEN" &&
                      pricing.advanceDeposit !== snapshot.advanceDeposit
                    }
                  />
                  {pricing.priceSource === "OVERRIDDEN" && (
                    <p className={`text-[11px] ${TONE_TEXT.warning} py-1`}>
                      This departure has been repriced since it was created —
                      the price shown under &quot;In this group&quot; is what
                      it sells at now, not the frozen snapshot.
                    </p>
                  )}
                </>
              )}
              <div className="flex items-center justify-between py-2 text-sm">
                <span className="text-muted-foreground">
                  Inclusions / exclusions frozen for this group
                </span>
                <span className="text-foreground font-number">
                  {snapshot.inclusions.length} / {snapshot.exclusions.length}
                </span>
              </div>
              <Line
                label="Itinerary days copied"
                frozen={`${snapshot.itinerary.length} days`}
                live={`${group.durationDays} days on the group`}
                drifted={
                  snapshot.itinerary.length > 0 &&
                  snapshot.itinerary.length !== group.durationDays
                }
              />
            </div>
          </div>

          <Separator />

          <div>
            <p className="text-xs font-medium text-foreground mb-1">
              Execution against the copy
            </p>
            <div className="divide-y divide-border/30">
              <Line
                label="Accommodation blocks copied"
                frozen={`${accommodations.length} block${
                  accommodations.length === 1 ? "" : "s"
                } · ${nights} night${nights === 1 ? "" : "s"}`}
                live={`${confirmedHotels} of ${accommodations.length} confirmed`}
                drifted={confirmedHotels < accommodations.length}
              />
              <Line
                label="Transport routes copied"
                frozen={`${transports.length} route${
                  transports.length === 1 ? "" : "s"
                }`}
                live={`${confirmedTransport} of ${transports.length} confirmed`}
                drifted={confirmedTransport < transports.length}
              />
              <Line
                label="Readiness checklist copied"
                frozen={`${readinessItems.length} requirement${
                  readinessItems.length === 1 ? "" : "s"
                }`}
                live={`${completedReadiness} complete · ${group.readinessScore}% ready`}
                drifted={completedReadiness < readinessItems.length}
              />
              <Line
                label="Capacity at creation"
                frozen={`${group.capacity} seats`}
                live={`${group.bookedSeats} booked · ${group.availableSeats} available`}
              />
            </div>
          </div>

          {snapshot.inclusions.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-foreground">
                  Inclusions frozen for this group
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {snapshot.inclusions.map((inclusion) => (
                    <Badge
                      key={inclusion}
                      variant="outline"
                      className="text-[10px] text-muted-foreground"
                    >
                      {inclusion}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateComparisonDialog;
