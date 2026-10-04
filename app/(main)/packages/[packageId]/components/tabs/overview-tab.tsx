"use client";

import React from "react";
import { FileText, Info } from "lucide-react";

import type { PackageRow } from "@/lib/types/database";
import type { PackageUsageSummary } from "@/lib/data/packages-repository";
import { DetailSection, Field, FieldGrid } from "../detail-field";
import type { PackageDetailTabId } from "../package-detail";
import { Button } from "@/components/ui/button";

export default function OverviewTab({
  pkg,
  usage,
  onNavigate,
}: {
  pkg: PackageRow;
  usage: PackageUsageSummary;
  onNavigate: (tab: PackageDetailTabId) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <DetailSection
        title="Commercial Identity"
        icon={<Info className="size-4 text-primary" />}
      >
        <FieldGrid>
          <Field label="Journey Type" value={pkg.journey_type} />
          <Field label="Category" value={pkg.package_category} />
          <Field label="Branch" value={pkg.branch} />
          <Field label="Planned Capacity" value={pkg.default_capacity} />
          <Field label="Minimum Group Size" value={pkg.min_group_size} />
          <Field
            label="Waitlist"
            value={pkg.waitlist_enabled ? "Enabled" : "Disabled"}
          />
          <Field label="Seat Hold Expiry" value={pkg.seat_hold_expiry} />
          <Field label="Max Pilgrims" value={pkg.max_pilgrims} />
        </FieldGrid>
      </DetailSection>

      <DetailSection
        title="Overview"
        icon={<FileText className="size-4 text-primary" />}
      >
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
          {pkg.description || "No overview written yet."}
        </p>
      </DetailSection>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => onNavigate("groups")}
          className="text-left rounded-md border border-border/40 bg-card/50 p-4 hover:border-primary/50 transition-colors"
        >
          <p className="text-xs text-muted-foreground">Price from</p>
          <p className="text-lg font-medium font-number text-foreground mt-1">
            {usage.fromPrice
              ? `${usage.fromPrice.currency} ${usage.fromPrice.amount.toLocaleString()}`
              : "—"}
          </p>
          {usage.fromPrice && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Quad occupancy · across {usage.liveGroupCount} live departure
              {usage.liveGroupCount === 1 ? "" : "s"}
            </p>
          )}
        </button>
        <button
          onClick={() => onNavigate("groups")}
          className="text-left rounded-md border border-border/40 bg-card/50 p-4 hover:border-primary/50 transition-colors"
        >
          <p className="text-xs text-muted-foreground">Departure groups</p>
          <p className="text-lg font-bold font-number text-foreground mt-1">
            {usage.liveGroupCount} live · {usage.groupCount} total
          </p>
        </button>
        <button
          onClick={() => onNavigate("journey")}
          className="text-left rounded-md border border-border/40 bg-card/50 p-4 hover:border-primary/50 transition-colors"
        >
          <p className="text-xs text-muted-foreground">Duration</p>
          <p className="text-lg font-bold font-number text-foreground mt-1">
            {pkg.duration}
          </p>
        </button>
      </div>

      <div className="flex justify-end">
        <Button variant="link" size="sm" onClick={() => onNavigate("pricing")}>
          Review full pricing details →
        </Button>
      </div>
    </div>
  );
}
