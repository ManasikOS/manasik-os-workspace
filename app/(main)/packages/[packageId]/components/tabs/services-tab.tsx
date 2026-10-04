"use client";

import React from "react";
import { Bus, CheckCircle2, Hotel, XCircle } from "lucide-react";

import type { PackageRow } from "@/lib/types/database";
import { Badge } from "@/components/ui/badge";
import { DetailSection, Field, FieldGrid, TabEmpty } from "../detail-field";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";

export default function ServicesTab({ pkg }: { pkg: PackageRow }) {
  return (
    <div className="flex flex-col gap-5">
      <DetailSection
        title="Makkah Accommodation"
        icon={<Hotel className="size-4 text-primary" />}
      >
        <FieldGrid>
          <Field label="Standard" value={pkg.makkah_accommodation_standard} />
          <Field label="Nights" value={pkg.makkah_nights} />
          <Field label="Meal Plan" value={pkg.makkah_meal_plan} />
          <Field label="Target Distance" value={pkg.makkah_target_distance} />
          <Field
            label="Occupancies"
            value={pkg.makkah_occupancies.join(", ")}
          />
          <Field
            label="Exact Hotel Guaranteed"
            value={
              pkg.makkah_exact_hotel_guarantee
                ? pkg.makkah_hotel || "Yes"
                : "No"
            }
          />
        </FieldGrid>
      </DetailSection>

      <DetailSection
        title="Madinah Accommodation"
        icon={<Hotel className="size-4 text-primary" />}
      >
        <FieldGrid>
          <Field label="Standard" value={pkg.madinah_accommodation_standard} />
          <Field label="Nights" value={pkg.madinah_nights} />
          <Field label="Meal Plan" value={pkg.madinah_meal_plan} />
          <Field label="Target Distance" value={pkg.madinah_target_distance} />
          <Field
            label="Occupancies"
            value={pkg.madinah_occupancies.join(", ")}
          />
          <Field
            label="Exact Hotel Guaranteed"
            value={
              pkg.madinah_exact_hotel_guarantee
                ? pkg.madinah_hotel || "Yes"
                : "No"
            }
          />
        </FieldGrid>
      </DetailSection>

      <DetailSection
        title="Transport"
        icon={<Bus className="size-4 text-primary" />}
      >
        <Field label="Transport Type" value={pkg.transport_type} />
        {pkg.transport_requirements.length === 0 ? (
          <TabEmpty title="No transport requirements defined" />
        ) : (
          <div className="flex flex-col gap-2 mt-3">
            {pkg.transport_requirements.map((t) => (
              <Card key={t.id} className="gap-2 px-4 py-3 text-sm">
                <p className="font-medium text-foreground">{t.routeLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {t.startLocation} → {t.destination} · {t.vehicleStandard}
                </p>
              </Card>
            ))}
          </div>
        )}
      </DetailSection>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <DetailSection
          title="Inclusions"
          icon={<CheckCircle2 className={cn("size-4", TONE_TEXT.success)} />}
        >
          {pkg.inclusions.length === 0 ? (
            <TabEmpty title="No inclusions listed" />
          ) : (
            <ul className="flex flex-col gap-3">
              {pkg.inclusions.map((i) => (
                <li
                  key={i}
                  className="text-sm text-foreground flex items-start gap-2"
                >
                  <CheckCircle2 className={cn("size-3.5 mt-0.5 shrink-0", TONE_TEXT.success)} />{" "}
                  {i}
                </li>
              ))}
            </ul>
          )}
        </DetailSection>
        <DetailSection
          title="Exclusions"
          icon={<XCircle className="size-4 text-destructive" />}
        >
          {pkg.exclusions.length === 0 ? (
            <TabEmpty title="No exclusions listed" />
          ) : (
            <ul className="flex flex-col gap-3">
              {pkg.exclusions.map((e) => (
                <li
                  key={e}
                  className="text-sm text-foreground flex items-start gap-2"
                >
                  <XCircle className="size-3.5 text-destructive mt-0.5 shrink-0" />{" "}
                  {e}
                </li>
              ))}
            </ul>
          )}
        </DetailSection>
      </div>

      <DetailSection title="Included Services">
        {pkg.included_services.length === 0 ? (
          <TabEmpty title="No included services listed" />
        ) : (
          <div className="flex flex-wrap gap-3">
            {pkg.included_services.map((s) => (
              <Badge key={s} variant="outline" className="text-sm px-3 py-3">
                {s}
              </Badge>
            ))}
          </div>
        )}
      </DetailSection>
    </div>
  );
}
