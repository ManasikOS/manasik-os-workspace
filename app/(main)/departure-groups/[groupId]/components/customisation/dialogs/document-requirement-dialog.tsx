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
  DepartureGroupManifestRow,
  DocumentStage,
} from "../../../../types";
import {
  DeviationCommonFields,
  DeviationFormFooter,
  deviationFieldsCls,
  useDeviationCommonFields,
  useDeviationSubmit,
} from "./common";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DocumentRequirementDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
  /** Render only the fields + footer, without an own Dialog wrapper, for use inside a master dialog. */
  embedded?: boolean;
}

const STAGES: { value: DocumentStage; label: string }[] = [
  { value: "ON_BOOKING", label: "On booking" },
  { value: "BEFORE_VISA_SUBMISSION", label: "Before visa submission" },
  { value: "BEFORE_FINAL_PAYMENT", label: "Before final payment" },
  { value: "BEFORE_DEPARTURE", label: "Before departure" },
];

const DocumentRequirementDialog = ({
  row,
  departureGroupId,
  open,
  onClose,
  embedded = false,
}: DocumentRequirementDialogProps) => {
  const [documentName, setDocumentName] = useState("");
  const [stage, setStage] = useState<DocumentStage>("BEFORE_DEPARTURE");

  const common = useDeviationCommonFields({ blocksDeparture: true });

  useResetOnOpen(open, row?.id ?? "", () => {
    setDocumentName("");
    setStage("BEFORE_DEPARTURE");
    common.reset();
  });

  const detail = documentName.trim()
    ? {
        kind: "DOCUMENT_REQUIREMENT" as const,
        documentName: documentName.trim(),
        requiredByStage: stage,
      }
    : null;

  const autoSummary = detail
    ? `Additional document: ${detail.documentName}`
    : "";

  const { submit, isPending } = useDeviationSubmit({
    pilgrim: row,
    departureGroupId,
    deviationType: "DOCUMENT_REQUIREMENT",
    onClose,
  });

  if (!row) return null;

  const body = (
    <>
      <div className={deviationFieldsCls}>
        <InputGroup>
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>Document Name</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder="e.g Medical"
            value={documentName}
            onChange={(e) => setDocumentName(e.target.value)}
          />
        </InputGroup>

        <DropdownMenu>
          <DropdownMenuTrigger>
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText>Stage</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={STAGES.find((s) => s.value === stage)?.label ?? stage}
                readOnly
                className="cursor-pointer"
              />
            </InputGroup>
          </DropdownMenuTrigger>

          <DropdownMenuContent>
            {STAGES.map((s, index) => (
              <DropdownMenuItem
                key={index}
                onClick={() => setStage(s.value)}
                className="cursor-pointer"
              >
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

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
          <DialogTitle>Document Requirement</DialogTitle>
          <DialogDescription>{row.fullName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
};

export default DocumentRequirementDialog;
