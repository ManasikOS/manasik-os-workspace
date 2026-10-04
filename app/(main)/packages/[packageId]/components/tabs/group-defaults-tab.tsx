"use client";

import React from "react";
import { ListChecks, Settings2 } from "lucide-react";

import type { PackageRow } from "@/lib/types/database";
import { Badge } from "@/components/ui/badge";
import { DetailSection, Field, FieldGrid, TabEmpty } from "../detail-field";
import { Card } from "@/components/ui/card";

export default function GroupDefaultsTab({ pkg }: { pkg: PackageRow }) {
  return (
    <div className="flex flex-col gap-5">
      <DetailSection
        title="Group Creation Defaults"
        icon={<Settings2 className="size-4 text-primary" />}
      >
        <FieldGrid>
          <Field
            label="Default Group Capacity"
            value={pkg.default_group_capacity}
          />
          <Field
            label="Default Group Status"
            value={pkg.default_group_status}
          />
        </FieldGrid>
      </DetailSection>

      <DetailSection
        title="Readiness Checklist"
        icon={<ListChecks className="size-4 text-primary" />}
      >
        {pkg.group_readiness_checklist.length === 0 ? (
          <TabEmpty title="No readiness checklist items defined" />
        ) : (
          <div className="flex flex-col gap-2">
            {pkg.group_readiness_checklist.map((r) => (
              <Card
                key={r.id}
                className="flex flex-row items-center justify-between px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-foreground">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{r.dueTiming}</p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {r.responsibleRole}
                </Badge>
              </Card>
            ))}
          </div>
        )}
      </DetailSection>
    </div>
  );
}
