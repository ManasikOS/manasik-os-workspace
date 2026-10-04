"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import React, { useState } from "react";

import type {
  DepartureGroupAccommodation,
  DepartureGroupManifestRow,
} from "../../../../types";
import {
  DeviationCommonFields,
  DeviationFormFooter,
  deviationFieldsCls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";
import { SelectMenu } from "@/app/(main)/departure-groups/components/add-booking-sheet";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

interface MealPlanDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  accommodations: DepartureGroupAccommodation[];
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const MealPlanDialog = ({
  row,
  departureGroupId,
  accommodations,
  open,
  onClose,
  embedded = false,
}: MealPlanDialogProps) => {
  const [accommodationId, setAccommodationId] = useState("");
  const [mealPlan, setMealPlan] = useState("");

  const common = useDeviationCommonFields({ blocksDeparture: false });

  useResetOnOpen(open, row?.id ?? "", () => {
    setAccommodationId("");
    setMealPlan("");
    common.reset();
  });

  const detail = mealPlan.trim()
    ? {
        kind: "MEAL_PLAN" as const,
        accommodationId: accommodationId || null,
        mealPlan: mealPlan.trim(),
      }
    : null;

  const autoSummary = detail ? `Meal plan: ${detail.mealPlan}` : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "MEAL_PLAN",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        {accommodations.length > 0 && (
          <SelectMenu
            label="Link to accommodation (Optional)"
            value={accommodationId}
            onChange={(e) => setAccommodationId(e)}
            options={accommodations.map((a) => {
              return {
                value: a.id,
                label: a.hotelName,
              };
            })}
          />
        )}
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>Meal Plan</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Meal plan — e.g. Full board, Breakfast only"
            value={mealPlan}
            onChange={(e) => setMealPlan(e.target.value)}
          />
        </InputGroup>

        <DeviationCommonFields common={common} autoSummary={autoSummary} />
      </div>

      <DeviationFormFooter
        embedded={embedded}
        onClose={onClose}
        onSubmit={() => submit(detail, common, autoSummary)}
        disabled={!detail || isPending}
        isPending={isPending}
      />
    </>
  );

  if (embedded) return body;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md! flex! max-h-[85vh] flex-col! overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Meal Plan Change</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default MealPlanDialog;
