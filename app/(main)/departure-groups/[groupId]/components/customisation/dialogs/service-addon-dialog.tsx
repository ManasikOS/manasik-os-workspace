"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import React, { useState } from "react";

import type {
  DepartureGroupManifestRow,
  ServiceAddon,
} from "../../../../types";
import {
  DeviationCommonFields,
  DeviationFormFooter,
  deviationFieldsCls,
  deviationGrid2Cls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";

interface ServiceAddonDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  addons: ServiceAddon[];
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const ServiceAddonDialog = ({
  row,
  departureGroupId,
  addons,
  open,
  onClose,
  embedded = false,
}: ServiceAddonDialogProps) => {
  const [addonId, setAddonId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");

  const firstAddon = addons[0] ?? null;
  const common = useDeviationCommonFields({
    blocksDeparture: false,
    addCharge: true,
    chargeLabel: firstAddon?.name,
    chargeAmount:
      firstAddon?.defaultAmount != null
        ? String(firstAddon.defaultAmount)
        : undefined,
    addonId: firstAddon?.id,
  });

  useResetOnOpen(open, row?.id ?? "", () => {
    setAddonId(firstAddon?.id ?? "");
    setQuantity("1");
    setNote("");
    common.reset();
  });

  const selectAddon = (id: string) => {
    setAddonId(id);
    common.setAddonId(id);
    const addon = addons.find((a) => a.id === id);
    if (addon?.defaultAmount != null) {
      common.setChargeAmount(String(addon.defaultAmount));
      common.setChargeLabel(addon.name);
    }
  };

  const detail = {
    kind: "SERVICE_ADDON" as const,
    addonId: addonId || null,
    ...(addonId
      ? { addonCode: addons.find((a) => a.id === addonId)?.code }
      : {}),
    quantity: Number(quantity) || 1,
    ...(note ? { note } : {}),
  };

  const autoSummary = `Service add-on${detail.addonCode ? `: ${detail.addonCode}` : ""}${
    detail.note ? ` — ${detail.note}` : ""
  } (×${detail.quantity})`;

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "SERVICE_ADDON",
    suggestedChargeType: "ADDON",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        {addons.length > 0 ? (
          <Select value={addonId} onValueChange={(value) => selectAddon(value as string)}>
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="Select add-on" />
            </SelectTrigger>
            <SelectContent>
              {addons.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-xs">
                  {a.name}{" "}
                  {a.defaultAmount != null ? `(${a.defaultAmount} LKR)` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground">
            No add-ons configured. Type a description below.
          </p>
        )}
        <div className={deviationGrid2Cls}>
          <Input
            type="number"
            min={1}
            placeholder="Quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <Input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <DeviationCommonFields
          common={common}
          autoSummary={autoSummary}
          chargeQuantity={detail.quantity}
          chargeQuantityLabel="units"
        />
      </div>

      <DeviationFormFooter
        embedded={embedded}
        onClose={onClose}
        onSubmit={() => submit(detail, common, autoSummary, detail.quantity)}
        disabled={isPending}
        isPending={isPending}
      />
    </>
  );

  if (embedded) return body;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md! flex! max-h-[85vh] flex-col! overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Service Add-on</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default ServiceAddonDialog;
