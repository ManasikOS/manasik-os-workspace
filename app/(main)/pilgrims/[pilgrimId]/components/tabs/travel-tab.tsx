"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import React from "react";

import type { PilgrimProfile } from "../../../types";
import { FLIGHT_STATUS_LABELS, ROOM_STATUS_LABELS } from "../../../utils";
import SectionHeading from "@/components/section-heading";

export default function TravelTab({ profile }: { profile: PilgrimProfile }) {
  const journey = profile.activeJourneyRaw;
  if (!journey)
    return (
      <EmptyState
        title="No active journey"
        description="Travel details apply once this pilgrim is enrolled on a group."
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-3">
        <div className="flex items-center justify-between">
          <SectionHeading title="Flight" />
          <ToneBadge
            tone={journey.flight_status === "TICKETED" ? "success" : "warning"}
            label={
              FLIGHT_STATUS_LABELS[journey.flight_status] ??
              journey.flight_status
            }
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Flight legs, PNR and seat allocation are managed on the departure
          group&apos;s Flights tab and reflected here.
        </p>
      </Card>

      <Card className="gap-3">
        <div className="flex items-center justify-between">
          <SectionHeading title="Rooming" />
          <ToneBadge
            tone={
              journey.room_assignment_status === "UNASSIGNED"
                ? "warning"
                : "success"
            }
            label={
              ROOM_STATUS_LABELS[journey.room_assignment_status] ??
              journey.room_assignment_status
            }
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {journey.room_assignment_status === "UNASSIGNED"
            ? "No room assigned yet. Rooming is managed from the departure group's Hotels & Rooms tab."
            : "A room has been assigned for this journey. See the departure group's Hotels & Rooms tab for the hotel, room number and occupants."}
        </p>
      </Card>

      <Card className="gap-2">
        <SectionHeading title="Group Logistics" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">Guide</span>
            {journey.primary_guide_name ?? "Not yet assigned"}
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Departs</span>
            {journey.departure_date}
          </div>
        </div>
      </Card>

      <Link
        href={`/departure-groups/${journey.departure_group_id}?tab=flights`}
      >
        <Button variant="outline_without_border">
          <ExternalLink /> Manage flights, rooming & transport in{" "}
          {journey.group_name}
        </Button>
      </Link>
    </div>
  );
}
