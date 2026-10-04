"use client";

import React from "react";
import { CalendarDays, Plane } from "lucide-react";

import type { PackageRow } from "@/lib/types/database";
import { Badge } from "@/components/ui/badge";
import { DetailSection, Field, FieldGrid, TabEmpty } from "../detail-field";
import { Card } from "@/components/ui/card";

export default function JourneyTab({ pkg }: { pkg: PackageRow }) {
  return (
    <div className="flex flex-col gap-5">
      <DetailSection
        title="Journey"
        icon={<Plane className="size-4 text-primary" />}
      >
        <FieldGrid>
          <Field label="Duration" value={pkg.duration} />
          <Field
            label="Days / Nights"
            value={`${pkg.days}D / ${pkg.nights}N`}
          />
        </FieldGrid>
        <p className="text-xs text-muted-foreground mt-2">
          Flight routing (origin, gateway, airline, cabin class) is set per
          Departure Group, not on the template — see the group&apos;s own
          Flights tab.
        </p>
      </DetailSection>

      <DetailSection
        title="Itinerary"
        icon={<CalendarDays className="size-4 text-primary" />}
      >
        {pkg.itinerary.length === 0 ? (
          <TabEmpty title="No itinerary days added yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {pkg.itinerary
              .slice()
              .sort((a, b) => a.dayNumber - b.dayNumber)
              .map((day) => (
                <Card key={day.id} className="px-4 py-3 gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-[10px] font-number"
                    >
                      Day {day.dayNumber}
                    </Badge>
                    <p className="text-sm font-medium text-foreground">
                      {day.title}
                    </p>
                    {day.category && (
                      <Badge variant="outline" className="text-[10px]">
                        {day.category}
                      </Badge>
                    )}
                  </div>
                  {day.location && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {day.location}
                    </p>
                  )}
                  <p className="text-xs text-foreground mt-1">
                    {day.description}
                  </p>
                </Card>
              ))}
          </div>
        )}
      </DetailSection>
    </div>
  );
}
