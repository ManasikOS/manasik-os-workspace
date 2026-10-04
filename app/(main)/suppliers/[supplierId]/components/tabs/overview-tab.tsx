"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import Link from "next/link";
import React from "react";

import type { SupplierTabId } from "@/lib/access/suppliers-access";
import {
  OVERVIEW_LIST_CAP,
  SERVICE_CATEGORY_LABELS,
} from "@/lib/data/suppliers-copy";
import { commitmentStatusTone } from "@/lib/data/suppliers";
import { COMMITMENT_STATUS_LABELS } from "../../../utils";
import type { SupplierCapabilities, SupplierProfile } from "../../../types";
import SectionHeading from "@/components/section-heading";

interface OverviewTabProps {
  profile: SupplierProfile;
  nowIso: string;
  can: SupplierCapabilities;
  onNavigate: (tab: SupplierTabId) => void;
}

export default function OverviewTab({
  profile,
  can,
  onNavigate,
}: OverviewTabProps) {
  const current = profile.commitments
    .filter((c) => c.status !== "CANCELLED" && c.status !== "COMPLETED")
    .slice(0, OVERVIEW_LIST_CAP);

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Current commitments"
        act={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate("commitments")}
          >
            View all
          </Button>
        }
      />

      {current.length === 0 ? (
        <EmptyState
          title="No active commitments"
          description="Add a commitment to link this supplier to a Departure Group."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {current.map((c) => (
            <Card key={c.id} className="gap-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {c.service_label ||
                      SERVICE_CATEGORY_LABELS[c.service_category]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {c.service_details ||
                      SERVICE_CATEGORY_LABELS[c.service_category]}
                  </span>
                  {c.service_start_date && (
                    <span className="text-xs text-muted-foreground">
                      {c.service_start_date}
                      {c.service_end_date ? ` – ${c.service_end_date}` : ""}
                    </span>
                  )}
                </div>
                <ToneBadge
                  tone={commitmentStatusTone(c.status)}
                  label={COMMITMENT_STATUS_LABELS[c.status] ?? c.status}
                />
              </div>
              <div className="flex items-center justify-between">
                <Link
                  href={`/departure-groups/${c.departure_group_id}`}
                  className="text-xs text-primary hover:underline"
                >
                  Open Departure Group
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate("commitments")}
                >
                  Open Commitment
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!can.viewCosts && (
        <p className="text-xs text-muted-foreground">
          Costs, payment terms and rates are hidden for your role.
        </p>
      )}
    </div>
  );
}
