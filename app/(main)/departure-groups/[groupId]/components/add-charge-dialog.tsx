"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { cn } from "@/lib/utils";
import { addChargeSchema } from "@/lib/validations/departure-groups";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { addPilgrimChargeAction } from "../../actions";
import type {
  ChargeType,
  DepartureGroupManifestRow,
  ServiceAddon,
} from "../../types";
import { SelectMenu } from "../../components/add-booking-sheet";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ButtonGroup } from "@/components/ui/button-group";
import { CURRENT_CURRENCY } from "@/lib/data/suppliers-copy";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Card } from "@/components/ui/card";

interface AddChargeDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
  /** The add-on catalogue, so a charge can be linked to it instead of hand-typed. */
  addons?: ServiceAddon[];
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const CHARGE_TYPE_LABELS: Record<Exclude<ChargeType, "BASE_FARE">, string> = {
  ROOM_UPGRADE: "Room upgrade",
  EXTRA_NIGHTS: "Extra nights",
  FLIGHT_VARIATION: "Flight variation",
  TRANSPORT_VARIATION: "Transport variation",
  ADDON: "Add-on",
  DISCOUNT: "Discount",
  SURCHARGE: "Surcharge",
  PRICE_CORRECTION: "Price correction",
  CANCELLATION_FEE: "Cancellation fee",
};

const ADDABLE_CHARGE_TYPES = Object.keys(CHARGE_TYPE_LABELS) as Exclude<
  ChargeType,
  "BASE_FARE"
>[];

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Adds a one-off charge (or discount) against a single pilgrim, mirroring the
 * inline form that used to live inside the customisation drawer's price
 * breakdown card. Split out so it can be triggered directly from the row
 * context menu instead of requiring the full drawer to be opened first.
 */
const AddChargeDialog = ({
  row,
  departureGroupId,
  open,
  onClose,
  addons = [],
  embedded = false,
}: AddChargeDialogProps) => {
  const [isPending, startTransition] = useTransition();

  const [chargeType, setChargeType] =
    useState<Exclude<ChargeType, "BASE_FARE">>("ADDON");
  const [addonId, setAddonId] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, row?.id ?? "", () => {
    setChargeType("ADDON");
    setAddonId("");
    setLabel("");
    setAmount("");
    setReason("");
    setError(null);
  });

  const selectAddon = (id: string) => {
    setAddonId(id);
    if (!id) return;
    const addon = addons.find((a) => a.id === id);
    if (!addon) return;
    setChargeType("ADDON");
    setLabel(addon.name);
    if (addon.defaultAmount != null) setAmount(String(addon.defaultAmount));
  };

  const submit = () => {
    setError(null);
    if (!row) return;
    const parsedAmount = Number(amount);

    const payload = {
      departureGroupId,
      groupPilgrimId: row.id,
      chargeType,
      addonId: addonId || undefined,
      label,
      amount:
        chargeType === "DISCOUNT"
          ? -Math.abs(parsedAmount)
          : Math.abs(parsedAmount),
      reason: reason || undefined,
    };

    const check = addChargeSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That charge is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await addPilgrimChargeAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.add({ title: "Charge added", description: row.fullName });
      onClose();
    });
  };

  const body = (
    <>
      <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto custom-scroll">
        {addons.length > 0 && (
          <SelectMenu
            value={addonId}
            options={[
              { value: "", label: "Type it manually" },
              ...addons.map((a) => ({
                value: a.id,
                label:
                  a.defaultAmount != null
                    ? `${a.name} (${a.defaultAmount} LKR)`
                    : a.name,
              })),
            ]}
            onChange={(e) => selectAddon(e)}
            label={"From catalogue (optional)"}
          />
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SelectMenu
            value={chargeType}
            options={ADDABLE_CHARGE_TYPES.map((t) => ({
              value: t,
              label: CHARGE_TYPE_LABELS[t],
            }))}
            onChange={(e) => {
              setChargeType(e as Exclude<ChargeType, "BASE_FARE">);
            }}
            label={"Charge Type"}
          />

          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Amount</InputGroupText>
            </InputGroupAddon>

            <ButtonGroup>
              <InputGroupInput
                className="flex-1"
                readOnly
                value={CURRENT_CURRENCY}
              />
              <CurrencyInput
                placeholder="0.0 "
                className="flex-5 "
                onValueChange={(e) => setAmount(String(e))}
                value={parseInt(amount)}
              />
            </ButtonGroup>
          </InputGroup>
        </div>
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>Label</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder=" e.g. Single room upgrade"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>Reason</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea
            rows={2}
            placeholder={
              chargeType === "DISCOUNT" || chargeType === "PRICE_CORRECTION"
                ? "Type reason for approval"
                : "Type your reason"
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </InputGroup>

        {error && (
          <Card className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </Card>
        )}
      </div>

      <DialogFooter
        className={cn(
          "shrink-0",
          embedded && "mx-0 mb-0 border-t border-border/60 px-0 pt-3 pb-0",
        )}
      >
        <Button
          variant="ghost"
          onClick={onClose}
          disabled={isPending}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          onClick={submit}
          className="w-full sm:w-auto"
          disabled={
            isPending || !label.trim() || !amount || Number(amount) === 0
          }
        >
          {isPending && <Loader2 className="animate-spin" />}
          Add charge
        </Button>
      </DialogFooter>
    </>
  );

  if (embedded) return body;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Add Charge</DialogTitle>
          <DialogDescription>{row?.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default AddChargeDialog;
