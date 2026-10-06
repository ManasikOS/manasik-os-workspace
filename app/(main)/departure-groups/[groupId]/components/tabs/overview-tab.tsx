"use client";

import SectionHeading from "@/components/section-heading";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { type StaffRole } from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CircleCheck,
  UserRound,
} from "lucide-react";
import React from "react";

import {
  ProgressBar,
  SupplierStatusBadge,
} from "../../../components/status-badges";
import type {
  DepartureGroupOverview,
  DepartureGroupPackageSnapshot,
  DepartureGroupPricing,
  DepartureGroupCosting,
  DepartureGroupTabId,
  SupplierStatus,
} from "../../../types";
import {
  FLIGHT_STATUS_LABELS,
  SUPPLIER_STATUS_LABELS,
  departureCountdown,
  formatCurrency,
  formatDate,
  percentTone,
  readinessTone,
  relativeTimestamp,
} from "../../../utils";
import {
  TONE_CLASS,
  TONE_STAT_CARD,
  TONE_TEXT,
  type Tone,
} from "@/lib/ui/tone";
import CardItem from "@/components/ui/card-item";

import { ActorChip } from "@/components/ui/copilot-mark";
interface OverviewTabProps {
  overview: DepartureGroupOverview;
  snapshot: DepartureGroupPackageSnapshot;
  pricing: DepartureGroupPricing;
  costing: DepartureGroupCosting | null;
  /** Number of bookings (contracts), distinct from seats — see `group.bookedSeats`. */
  bookingCount: number;
  role: StaffRole;
  /** `filter` drills into a specific slice of the destination tab. */
  onNavigate: (tab: DepartureGroupTabId, filter?: string) => void;
  /** Cadence only — `state.lastRunAt`/`nextRunAt`. Deliberately not the full Agent tab payload; see the Blockers card below. */
  agentState: { lastRunAt: string | null; nextRunAt: string | null } | null;
}

function DepartureGroupOverviewMetric({
  title,
  value,
  caption,
  accent,
}: {
  title: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card className="justify-between gap-0">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p
          className={cn(
            "mt-2 tabular-nums  text-4xl font-semibold tracking-tight",
            accent,
          )}
        >
          {value}
        </p>
      </div>
      {caption && (
        <div className="mt-3 text-xs text-muted-foreground">{caption}</div>
      )}
    </Card>
  );
}

function CategoryCircleProgress({
  label,
  percent,
  complete,
  total,
  tone,
  onClick,
}: {
  label: string;
  percent: number;
  complete: number;
  total: number;
  tone: Tone;
  onClick: () => void;
}) {
  const r = 14;
  const circumference = 2 * Math.PI * r;
  const dash = (percent / 100) * circumference;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group/circ flex items-center gap-2.5 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <svg
        width="36"
        height="36"
        viewBox="0 0 36 36"
        className={cn("shrink-0 -rotate-90", TONE_TEXT[tone])}
      >
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-muted/60"
        />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground group-hover/circ:text-primary transition-colors truncate">
          {label}
        </p>
        <p
          className={cn("text-xs font-semibold tabular-nums", TONE_TEXT[tone])}
        >
          {percent}%
          <span className="ml-1 font-normal text-muted-foreground">
            {complete}/{total}
          </span>
        </p>
      </div>
    </button>
  );
}

/**
 * Answers four questions before anything else: is this group safe to depart,
 * what is blocked, what needs action today, and who owns it. Every red or amber
 * item on this tab links to the exact place that resolves it.
 */
const OverviewTab = ({
  overview,
  snapshot,
  pricing,
  costing,
  bookingCount,
  role,
  onNavigate,
  agentState,
}: OverviewTabProps) => {
  const can = useDepartureCapabilities(role);
  const { group, readiness, payments, blockers, suppliers, recentActivity } =
    overview;
  const criticalBlockerCount = blockers.filter(
    (b) => b.severity === "CRITICAL",
  ).length;
  const warningBlockerCount = blockers.length - criticalBlockerCount;

  // What's actually on track, named specifically — not a generic "all
  // clear." Falls back to the generic line only when there's nothing to
  // name yet (a brand-new group with no categories scored).
  const onTrackCategories = readiness.categories.filter(
    (c) => c.status === "READY",
  );
  const watchedLine =
    blockers.length === 0
      ? onTrackCategories.length > 0
        ? `${onTrackCategories.map((c) => c.label).join(", ")} ${onTrackCategories.length === 1 ? "is" : "are"} all tracking on schedule.`
        : "No outstanding blockers for this group."
      : null;

  return (
    <div className="flex flex-col gap-6">
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DepartureGroupOverviewMetric
          title="Departure readiness"
          value={`${readiness.score}%`}
          caption={
            <div className="flex flex-col gap-2">
              <ProgressBar
                percent={readiness.score}
                tone={
                  readiness.status === "NOT_STARTED"
                    ? "neutral"
                    : readinessTone(readiness.status)
                }
              />
              <button
                type="button"
                className="text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => onNavigate("readiness")}
              >
                {readiness.blockerCount} blocker
                {readiness.blockerCount === 1 ? "" : "s"} ·{" "}
                {readiness.dueTodayCount} due today
              </button>
            </div>
          }
        />
        <DepartureGroupOverviewMetric
          title="Departure countdown"
          value={
            group.daysUntilDeparture >= 0
              ? `${group.daysUntilDeparture} days`
              : "Departed"
          }
          caption={formatDate(group.departureDate)}
          accent={
            group.daysUntilDeparture >= 0 && group.daysUntilDeparture <= 14
              ? TONE_TEXT.warning
              : undefined
          }
        />
        <DepartureGroupOverviewMetric
          title="Seats booked"
          value={`${group.bookedSeats} / ${group.capacity}`}
          caption={
            <button
              type="button"
              className="text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => onNavigate("pilgrims")}
            >
              {bookingCount} booking{bookingCount === 1 ? "" : "s"}
              {group.heldSeats > 0
                ? ` · ${group.heldSeats} seat${group.heldSeats === 1 ? "" : "s"} on hold`
                : ""}{" "}
              · {group.availableSeats} available
            </button>
          }
        />
      </div>

      {can.viewFinance && costing && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DepartureGroupOverviewMetric
            title="Est. cost / pilgrim"
            value={formatCurrency(
              costing.estimatedVariableCostPerPax,
              pricing.currency,
            )}
            caption={
              costing.fixedCostPerDeparture > 0
                ? `+ ${formatCurrency(costing.fixedCostPerDeparture, pricing.currency)} fixed per departure`
                : "No fixed cost recorded for this departure"
            }
          />
          <DepartureGroupOverviewMetric
            title="Break-even headcount"
            value={
              costing.breakEvenHeadcount === null
                ? "—"
                : `${costing.breakEvenHeadcount} seats`
            }
            caption={
              costing.breakEvenHeadcount === null
                ? "Margin per seat is not positive at the current price"
                : `${costing.confirmedPax} confirmed so far`
            }
          />
          <DepartureGroupOverviewMetric
            title="Estimated margin"
            value={formatCurrency(
              costing.estimatedGrossMargin,
              pricing.currency,
            )}
            accent={
              costing.estimatedGrossMargin < 0
                ? TONE_TEXT.danger
                : TONE_TEXT.success
            }
            caption={`At ${costing.confirmedPax} confirmed seat${costing.confirmedPax === 1 ? "" : "s"}, before actual supplier reconciliation`}
          />
          {payments ? (
            <DepartureGroupOverviewMetric
              title="Collection status"
              accent={TONE_TEXT.success}
              value={formatCurrency(
                payments.collectedAmount,
                payments.currency,
              )}
              caption={
                <button
                  type="button"
                  className="text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => onNavigate("payments")}
                >
                  {formatCurrency(
                    payments.outstandingAmount,
                    payments.currency,
                  )}{" "}
                  outstanding
                </button>
              }
            />
          ) : (
            <DepartureGroupOverviewMetric
              title="Collection status"
              value="—"
              caption="Restricted to finance roles"
            />
          )}
        </div>
      )}

      {/* Blockers */}
      <Card className="gap-4">
        <SectionHeading
          title="Blockers"
          act={
            <span className="text-xs text-muted-foreground">
              {blockers.length === 0
                ? "Nothing blocking departure"
                : [
                    criticalBlockerCount > 0
                      ? `${criticalBlockerCount} critical`
                      : null,
                    warningBlockerCount > 0
                      ? `${warningBlockerCount} warning${warningBlockerCount === 1 ? "" : "s"}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          }
        />

        {agentState && (
          <p className="text-xs text-muted-foreground -mt-2">
            {agentState.lastRunAt
              ? `Reviewed ${relativeTimestamp(agentState.lastRunAt)}`
              : "Not yet reviewed"}
            {agentState.nextRunAt &&
              ` · Next check ${relativeTimestamp(agentState.nextRunAt)}`}
          </p>
        )}

        {blockers.length === 0 ? (
          <Card
            className={cn(
              "flex items-center gap-2 rounded-sm px-3 py-2.5 text-sm",
              TONE_CLASS.success,
            )}
          >
            <CircleCheck className="size-4" />
            {watchedLine}
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {blockers.map((blocker) => {
              const blockerTone: Tone =
                blocker.severity === "CRITICAL" ? "danger" : "warning";
              return (
                <Card
                  variant="md-shadow"
                  key={blocker.id}
                  className={cn(
                    "flex flex-row items-center rounded-sm px-2 py-1 border-none justify-between ",
                    TONE_STAT_CARD[blockerTone],
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle
                      className={cn("size-4 shrink-0", TONE_TEXT[blockerTone])}
                    />
                    <span className="text-sm text-foreground truncate">
                      <span
                        className={cn(
                          "font-medium mr-2",
                          TONE_TEXT[blockerTone],
                        )}
                      >
                        {blocker.severity === "CRITICAL"
                          ? "Critical"
                          : "Warning"}
                      </span>
                      {blocker.message}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onNavigate(blocker.tab, blocker.filter)}
                  >
                    {blocker.actionLabel} <ArrowRight className="size-3.5" />
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Readiness by category */}
        <Card className="gap-4">
          <SectionHeading
            title="Readiness by category"
            act={
              <Button
                variant="link"
                size="sm"
                onClick={() => onNavigate("readiness")}
              >
                Open checklist <ArrowRight className="size-3.5" />
              </Button>
            }
          />
          {readiness.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No readiness checklist has been copied to this group yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {readiness.categories.map((category) => (
                <CategoryCircleProgress
                  key={category.category}
                  label={category.label}
                  percent={category.percent}
                  complete={category.complete}
                  total={category.total}
                  tone={percentTone(category.percent)}
                  onClick={() => onNavigate(category.tab)}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Supplier summary */}
        <Card className="gap-4">
          <SectionHeading
            title="Supplier summary"
            act={
              <span className="text-xs text-muted-foreground">
                Flights, hotels and transport
              </span>
            }
          />
          <div className="flex flex-col divide-y divide-border/30">
            {suppliers.map((supplier, index) => (
              <button
                key={`${supplier.label}-${index}`}
                type="button"
                onClick={() => onNavigate(supplier.tab)}
                className="flex items-center justify-between gap-3 py-2.5 text-left group/row"
              >
                <span className="text-sm text-foreground group-hover/row:text-primary transition-colors truncate">
                  {supplier.label}
                </span>
                {isSupplierStatus(supplier.status) ? (
                  <SupplierStatusBadge value={supplier.status} />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {FLIGHT_STATUS_LABELS[supplier.status]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent high-impact activity */}
        <Card className="gap-4 lg:col-span-2">
          <SectionHeading
            title="Recent high-impact activity"
            act={
              <Button
                variant="link"
                size="sm"
                onClick={() => onNavigate("activity")}
              >
                View all <ArrowRight className="size-3.5" />
              </Button>
            }
          />
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No significant activity recorded yet.
            </p>
          ) : (
            <div className="flex flex-col gap-7">
              {recentActivity.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <UserRound className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{entry.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {relativeTimestamp(entry.createdAt)} ·{" "}
                      <ActorChip name={entry.actorName} inline />
                      {entry.isSystem && " · System"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Snapshot provenance */}
        <Card className="gap-3">
          <SectionHeading
            title="Package snapshot"
            act={<CalendarClock className="size-4 text-muted-foreground" />}
          />
          <p className="text-sm font-medium text-foreground">
            {snapshot.packageName}
          </p>
          <p className="text-xs text-muted-foreground font-number">
            {snapshot.packageCode}
          </p>
          <p className="text-xs text-muted-foreground">
            Copied {formatDate(snapshot.copiedAt)}. Later edits to the Package
            Template do not change this group.
          </p>
          {can.viewFinance && pricing.quadPrice !== null && (
            <p className="text-xs text-muted-foreground">
              Quad from{" "}
              <span className="font-number text-foreground">
                {formatCurrency(pricing.quadPrice, pricing.currency)}
              </span>
              {pricing.priceSource === "OVERRIDDEN" && (
                <span className={cn("ml-1", TONE_TEXT.warning)}>
                  (repriced)
                </span>
              )}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {snapshot.inclusions.length} inclusions ·{" "}
            {snapshot.itinerary.length} itinerary days
          </p>
          <p className="text-xs text-muted-foreground">
            {departureCountdown(group.daysUntilDeparture)}
          </p>
        </Card>
      </div>
    </div>
  );
};

function isSupplierStatus(value: string): value is SupplierStatus {
  return value in SUPPLIER_STATUS_LABELS;
}

export default OverviewTab;
