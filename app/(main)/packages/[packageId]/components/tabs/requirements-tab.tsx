"use client";

import React from "react";
import { FileCheck, MessageSquare } from "lucide-react";

import type { PackageRow } from "@/lib/types/database";
import { Badge } from "@/components/ui/badge";
import { DetailSection, Field, TabEmpty } from "../detail-field";
import { Card } from "@/components/ui/card";

export default function RequirementsTab({ pkg }: { pkg: PackageRow }) {
  return (
    <div className="flex flex-col gap-5">
      <DetailSection
        title="Traveller Requirements"
        icon={<FileCheck className="size-4 text-primary" />}
      >
        <Field
          label="Seat Reservation Rule"
          value={pkg.seat_reservation_rule}
        />
        {pkg.document_requirements.length === 0 ? (
          <TabEmpty title="No document requirements defined" />
        ) : (
          <div className="flex flex-col gap-2 mt-3">
            {pkg.document_requirements.map((d) => (
              <Card
                key={d.id}
                className="flex flex-row items-center justify-between  px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-foreground">{d.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {d.category} · Verified by {d.verifiedByRole}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {d.requiredByStage}
                </Badge>
              </Card>
            ))}
          </div>
        )}
      </DetailSection>

      <DetailSection
        title="Communication Templates"
        icon={<MessageSquare className="size-4 text-primary" />}
      >
        {pkg.selected_communication_templates.length === 0 ? (
          <TabEmpty title="No communication templates selected" />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pkg.selected_communication_templates.map((t) => (
              <Badge key={t} variant="outline" className="text-xs">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </DetailSection>
    </div>
  );
}
