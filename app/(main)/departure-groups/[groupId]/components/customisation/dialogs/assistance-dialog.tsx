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

import type { DepartureGroupManifestRow } from "../../../../types";
import {
  DeviationCommonFields,
  DeviationFormFooter,
  deviationFieldsCls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

interface AssistanceDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const ASSISTANCE_TYPES = [
  "WHEELCHAIR",
  "MEDICAL",
  "DIETARY",
  "MOBILITY",
  "OTHER",
] as const;

const AssistanceDialog = ({
  row,
  departureGroupId,
  open,
  onClose,
  embedded = false,
}: AssistanceDialogProps) => {
  const [assistanceType, setAssistanceType] =
    useState<(typeof ASSISTANCE_TYPES)[number]>("WHEELCHAIR");
  const [details, setDetails] = useState("");

  const common = useDeviationCommonFields({ blocksDeparture: true });

  useResetOnOpen(open, row?.id ?? "", () => {
    setAssistanceType("WHEELCHAIR");
    setDetails("");
    common.reset();
  });

  const detail = details.trim()
    ? {
        kind: "ASSISTANCE" as const,
        assistanceType,
        details: details.trim(),
      }
    : null;

  const autoSummary = detail
    ? `Assistance (${detail.assistanceType.toLowerCase()}): ${detail.details}`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "ASSISTANCE",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText>Assistance Type</InputGroupText>
              </InputGroupAddon>

              <InputGroupInput
                value={
                  assistanceType.charAt(0) +
                  assistanceType.slice(1).toLowerCase()
                }
                placeholder="Select Assistance Type"
                readOnly
                className="cursor-pointer"
              />
            </InputGroup>
          </DropdownMenuTrigger>

          <DropdownMenuContent>
            {ASSISTANCE_TYPES.map((t) => (
              <DropdownMenuItem
                key={t}
                onClick={() =>
                  setAssistanceType(t as (typeof ASSISTANCE_TYPES)[number])
                }
              >
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>Note</InputGroupText>
          </InputGroupAddon>

          <InputGroupTextarea
            rows={2}
            placeholder="Describe the assistance needed"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
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
          <DialogTitle>Assistance / Accessibility</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default AssistanceDialog;
