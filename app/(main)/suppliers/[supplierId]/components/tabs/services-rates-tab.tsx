"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PermissionDenied, ToneBadge } from "@/components/ui/tone-badge";
import { Plus } from "lucide-react";
import React, { useMemo, useState } from "react";

import { SEASON_LABELS, SERVICE_CATEGORY_LABELS } from "@/lib/data/suppliers-copy";
import { formatMoney } from "../../../utils";
import type { SupplierCapabilities, SupplierProfile, SupplierServiceRow } from "../../../types";
import AddEditServiceDialog from "../add-edit-service-dialog";

interface ServicesRatesTabProps {
  profile: SupplierProfile;
  can: SupplierCapabilities;
}

const ALL_CATEGORIES = Object.keys(SERVICE_CATEGORY_LABELS);

export default function ServicesRatesTab({ profile, can }: ServicesRatesTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierServiceRow | null>(null);

  const availableCategories = useMemo(
    () => ALL_CATEGORIES.filter((c) => !profile.services.some((s) => s.category === c)),
    [profile.services],
  );

  if (!can.viewCosts) {
    return <PermissionDenied what="Services & Rates" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground max-w-md">
          Internal planning reference only. Customer pricing lives in Package Templates and group-specific price
          overrides — never here.
        </p>
        {availableCategories.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus /> Add Service
          </Button>
        )}
      </div>

      {profile.services.length === 0 ? (
        <EmptyState title="No service rates recorded" description="Add typical rates to help Operations plan new commitments." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {profile.services.map((service) => (
            <Card
              key={service.id}
              className="gap-2 cursor-pointer"
              onClick={() => {
                setEditing(service);
                setDialogOpen(true);
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{SERVICE_CATEGORY_LABELS[service.category]}</span>
                {service.season && <ToneBadge tone="neutral" label={SEASON_LABELS[service.season] ?? service.season} />}
              </div>
              {service.typical_service && <p className="text-xs text-muted-foreground">{service.typical_service}</p>}
              {service.typical_rate != null && (
                <span className="text-sm font-medium text-foreground">
                  {formatMoney(service.typical_rate, service.rate_currency ?? "SAR")}
                  {service.rate_unit ? ` / ${service.rate_unit}` : ""}
                </span>
              )}
              {service.notes && <p className="text-xs text-muted-foreground">{service.notes}</p>}
            </Card>
          ))}
        </div>
      )}

      <AddEditServiceDialog
        supplierId={profile.supplier.id}
        open={dialogOpen}
        existing={editing}
        availableCategories={availableCategories}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
