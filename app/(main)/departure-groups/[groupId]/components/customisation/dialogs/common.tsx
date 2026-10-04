"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import React, { useState, useTransition } from "react";

import { requestPilgrimCustomisationAction } from "../../../../actions";
import type {
  ChargeType,
  DepartureGroupManifestRow,
  DeviationDetail,
  DeviationType,
} from "../../../../types";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Card } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { ButtonGroup } from "@/components/ui/button-group";
import { CURRENT_CURRENCY } from "@/lib/data/suppliers-copy";

/**
 * The scrollable field column of an embedded deviation form. `flex-1 min-h-0`
 * is what keeps the footer pinned and visible: without it the column grows past
 * the master dialog's fixed-height content area and pushes the actions out of
 * the clipped region.
 */
export const deviationFieldsCls =
  "custom-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-0.5";

/** Two-column grid that collapses to one column on narrow viewports. */
export const deviationGrid2Cls = "grid grid-cols-1 gap-2 sm:grid-cols-2";

/** Three-column grid that collapses to one column on narrow viewports. */
export const deviationGrid3Cls =
  "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3";

/**
 * The actionable footer every deviation form ends with. `DialogFooter` bleeds
 * into a standalone dialog's `px-6 py-6` padding, so embedded copies neutralise
 * those negative margins and draw their own separator instead.
 */
export function DeviationFormFooter({
  embedded,
  onClose,
  onSubmit,
  disabled,
  isPending,
  submitLabel = "Create customisation",
}: {
  embedded?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  disabled?: boolean;
  isPending?: boolean;
  submitLabel?: string;
}) {
  return (
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
        disabled={disabled}
        onClick={onSubmit}
        className="w-full sm:w-auto"
      >
        {isPending && <Loader2 className="animate-spin" />}
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}

/**
 * State shared by every deviation dialog: the editable summary, the optional
 * paired charge, whether it blocks departure, and internal notes. Each
 * specific dialog owns its own type-specific fields on top of this.
 */
export function useDeviationCommonFields(defaults: {
  blocksDeparture?: boolean;
  addCharge?: boolean;
  chargeLabel?: string;
  chargeAmount?: string;
  /** Catalogue add-on this charge prices — see `addChargeInStore`'s `addon_id`/`source`. */
  addonId?: string;
}) {
  const [summary, setSummary] = useState("");
  const [blocksDeparture, setBlocksDeparture] = useState(
    defaults.blocksDeparture ?? true,
  );
  const [addCharge, setAddCharge] = useState(defaults.addCharge ?? false);
  const [chargeLabel, setChargeLabel] = useState(defaults.chargeLabel ?? "");
  const [chargeAmount, setChargeAmount] = useState(defaults.chargeAmount ?? "");
  const [chargeReason, setChargeReason] = useState("");
  const [generalNote, setGeneralNote] = useState("");
  const [addonId, setAddonId] = useState(defaults.addonId ?? "");

  const reset = () => {
    setSummary("");
    setBlocksDeparture(defaults.blocksDeparture ?? true);
    setAddCharge(defaults.addCharge ?? false);
    setChargeLabel(defaults.chargeLabel ?? "");
    setChargeAmount(defaults.chargeAmount ?? "");
    setChargeReason("");
    setGeneralNote("");
    setAddonId(defaults.addonId ?? "");
  };

  return {
    summary,
    setSummary,
    blocksDeparture,
    setBlocksDeparture,
    addCharge,
    setAddCharge,
    chargeLabel,
    setChargeLabel,
    chargeAmount,
    setChargeAmount,
    chargeReason,
    setChargeReason,
    generalNote,
    setGeneralNote,
    addonId,
    setAddonId,
    reset,
  };
}

export type DeviationCommonFields = ReturnType<typeof useDeviationCommonFields>;

/** The summary field, optional charge block, blocks-departure toggle and notes. */
export function DeviationCommonFields({
  common,
  autoSummary,
  chargeQuantity = 1,
  chargeQuantityLabel,
}: {
  common: DeviationCommonFields;
  autoSummary: string;
  /**
   * How many units the paired charge actually bills for — e.g. nights for
   * `EXTRA_NIGHTS`, pax for a per-person add-on. The amount field is always
   * a per-unit rate; this is what turns it into a total. Defaults to 1 for
   * dialogs with no per-unit concept.
   */
  chargeQuantity?: number;
  /** e.g. "nights" or "pax" — shown next to the multiplier when quantity > 1. */
  chargeQuantityLabel?: string;
}) {
  return (
    <>
      <InputGroup>
        <InputGroupAddon align={"block-start"}>
          <InputGroupText>Summary (auto-generated, editable)</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          placeholder="Brief description for the manifest"
          value={common.summary || autoSummary}
          onChange={(e) => common.setSummary(e.target.value)}
        />
      </InputGroup>

      <Card className="px-4 py-3 shadow-xs bg-card/10 min-h-fit">
        <InputGroupAddon align={"block-start"}>
          <Checkbox
            checked={common.addCharge}
            onCheckedChange={(v) => common.setAddCharge(v === true)}
          />
          Add a charge for this
        </InputGroupAddon>
        {common.addCharge && (
          <div className="flex flex-col gap-4">
            <InputGroupInput
              placeholder="Charge label"
              value={common.chargeLabel}
              onChange={(e) => common.setChargeLabel(e.target.value)}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ButtonGroup>
                <InputGroupInput
                  value={CURRENT_CURRENCY}
                  readOnly
                  className="flex-1"
                />

                <CurrencyInput
                  className="flex-5"
                  placeholder="Amount (LKR)"
                  value={
                    common.chargeAmount === ""
                      ? ""
                      : Number(common.chargeAmount)
                  }
                  onValueChange={(v) => common.setChargeAmount(String(v))}
                />
              </ButtonGroup>

              <InputGroupInput
                placeholder="Reason (optional)"
                value={common.chargeReason}
                onChange={(e) => common.setChargeReason(e.target.value)}
              />
            </div>
            {chargeQuantity > 1 && common.chargeAmount && (
              <p className="text-xs text-muted-foreground">
                × {chargeQuantity}
                {chargeQuantityLabel ? ` ${chargeQuantityLabel}` : ""} — total{" "}
                {CURRENT_CURRENCY}{" "}
                {(
                  Math.abs(Number(common.chargeAmount)) * chargeQuantity
                ).toLocaleString("en-US")}
              </p>
            )}
          </div>
        )}
      </Card>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={common.blocksDeparture}
          onCheckedChange={(v) => common.setBlocksDeparture(v === true)}
        />
        Must be resolved before the group can depart
      </label>

      <InputGroupTextarea
        rows={2}
        placeholder="Internal notes (optional)"
        value={common.generalNote}
        onChange={(e) => common.setGeneralNote(e.target.value)}
      />
    </>
  );
}

/**
 * Submits a deviation (plus its optional paired charge) for one pilgrim.
 * Every specific dialog builds its own `detail` object and hands it here.
 */
export function useDeviationSubmit({
  pilgrim,
  departureGroupId,
  deviationType,
  suggestedChargeType,
  onClose,
}: {
  pilgrim: DepartureGroupManifestRow | null;
  departureGroupId: string;
  deviationType: DeviationType;
  suggestedChargeType?: ChargeType;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  const submit = (
    detail: DeviationDetail | null,
    common: DeviationCommonFields,
    autoSummary: string,
    /** Units the paired charge bills for — nights, pax, etc. Defaults to 1. */
    chargeQuantity: number = 1,
  ) => {
    if (!pilgrim || !detail) return;

    const finalSummary = common.summary.trim() || autoSummary;
    if (finalSummary.length < 3) {
      toast.add({
        title: "Summary too short",
        description: "Describe the deviation.",
      });
      return;
    }

    const charge =
      common.addCharge && common.chargeLabel.trim() && common.chargeAmount
        ? {
            chargeType: (suggestedChargeType ?? "ADDON") as ChargeType,
            addonId: common.addonId || undefined,
            label: common.chargeLabel.trim(),
            amount:
              (suggestedChargeType ?? "ADDON") === "DISCOUNT"
                ? -Math.abs(Number(common.chargeAmount))
                : Math.abs(Number(common.chargeAmount)),
            quantity: chargeQuantity > 0 ? chargeQuantity : 1,
            requiresApproval: false,
            reason: common.chargeReason || undefined,
          }
        : undefined;

    startTransition(async () => {
      try {
        const result = await requestPilgrimCustomisationAction({
          departureGroupId,
          groupPilgrimId: pilgrim.id,
          deviationType,
          summary: finalSummary,
          detail,
          blocksDeparture: common.blocksDeparture,
          notes: common.generalNote || undefined,
          charge,
        });
        if (!result.ok) {
          toast.add({ title: "Could not create", description: result.error });
          return;
        }
        toast.add({
          title: "Customisation created",
          description: pilgrim.fullName,
        });
        onClose();
      } catch {
        toast.add({
          title: "Error",
          description: "The change did not reach the server.",
        });
      }
    });
  };

  return { submit, isPending };
}
