"use client";

import { Loader2 } from "lucide-react";
import React, { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { VISA_TYPE_CATALOGUE, batchDeadlineDefault, defaultVisaTypeFor } from "@/lib/data/visa-copy";

import { createBatchAction } from "../actions";
import type { VisaListItem } from "../types";

interface CreateBatchSheetProps {
  applications: VisaListItem[];
  currentStaffName: string | null;
  open: boolean;
  onClose: () => void;
  preselectedGroupId?: string | null;
}

/** The spec's most important Visa-only capability. Ineligible pilgrims stay
 *  visible, disabled, with their blocker — hiding them just moves the "why
 *  isn't he in the batch?" question to a phone call. */
const CreateBatchSheet = ({ applications, currentStaffName, open, onClose, preselectedGroupId }: CreateBatchSheetProps) => {
  const [isPending, startTransition] = useTransition();

  const [groupId, setGroupId] = useState("");
  const [visaType, setVisaType] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ownerName, setOwnerName] = useState("");
  const [batchReference, setBatchReference] = useState("");
  const [deadline, setDeadline] = useState("");
  const [notes, setNotes] = useState("");

  const groupOptions = useMemo(
    () => [...new Map(applications.map((a) => [a.groupId, { groupName: a.groupName, groupCode: a.groupCode, journeyType: a.journeyType }])).entries()],
    [applications],
  );

  useResetOnOpen(open, preselectedGroupId ?? "new", () => {
    const initialGroup = preselectedGroupId ?? groupOptions[0]?.[0] ?? "";
    setGroupId(initialGroup);
    const group = groupOptions.find(([id]) => id === initialGroup)?.[1];
    const defaultType = group ? defaultVisaTypeFor(group.journeyType as keyof typeof VISA_TYPE_CATALOGUE) : "";
    setVisaType(defaultType);
    setSelected(new Set());
    setOwnerName(currentStaffName ?? "");
    setBatchReference("");
    setDeadline(batchDeadlineDefault().slice(0, 16));
    setNotes("");
  });

  const groupApplications = useMemo(() => applications.filter((a) => a.groupId === groupId), [applications, groupId]);
  const eligible = groupApplications.filter((a) => a.visaStatus === "READY_TO_SUBMIT" || a.visaStatus === "REWORK_REQUIRED");

  const toggle = (journeyId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(journeyId)) next.delete(journeyId);
      else next.add(journeyId);
      return next;
    });
  };

  const submit = () => {
    if (!groupId || !visaType.trim() || selected.size === 0 || !ownerName.trim() || !batchReference.trim()) return;
    startTransition(async () => {
      const result = await createBatchAction({
        departureGroupId: groupId,
        visaType: visaType.trim(),
        journeyIds: [...selected],
        ownerId: null,
        ownerName: ownerName.trim(),
        batchReference: batchReference.trim(),
        submissionDeadline: deadline ? new Date(deadline).toISOString() : null,
        notes: notes.trim() || null,
      });
      if (!result.ok) {
        toast.add({ title: "Could not create batch", description: result.error });
        return;
      }
      toast.add({ title: `Batch created — ${selected.size} application(s)` });
      onClose();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Visa Submission Batch</SheetTitle>
          <SheetDescription>Group applications ready to submit into one batch, with a named owner and deadline.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground">Departure Group *</label>
              <Select
                value={groupId}
                onValueChange={(value) => {
                  const groupValue = value as string;
                  setGroupId(groupValue);
                  setSelected(new Set());
                  const group = groupOptions.find(([id]) => id === groupValue)?.[1];
                  if (group) setVisaType(defaultVisaTypeFor(group.journeyType as keyof typeof VISA_TYPE_CATALOGUE));
                }}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map(([id, g]) => (
                    <SelectItem key={id} value={id} className="text-xs">
                      {g.groupName} ({g.groupCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground">Visa Type *</label>
              <Input value={visaType} onChange={(e) => setVisaType(e.target.value)} placeholder="Umrah Visa" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">
                Eligible Pilgrims — {eligible.length} ready to submit
              </label>
              <span className="text-[11px] text-muted-foreground">{selected.size} selected</span>
            </div>
            <div className="flex flex-col gap-1 max-h-72 overflow-y-auto custom-scroll rounded-md border border-border/40 p-1.5">
              {groupApplications.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No applications on this group.</p>
              ) : (
                groupApplications.map((a) => {
                  const eligibleRow = a.visaStatus === "READY_TO_SUBMIT" || a.visaStatus === "REWORK_REQUIRED";
                  const blocker =
                    a.gatingOutstanding > 0
                      ? `${a.gatingOutstanding} document(s) outstanding`
                      : a.visaStatus === "APPROVED"
                        ? "Visa already issued"
                        : a.visaStatus === "SUBMITTED" || a.visaStatus === "UNDER_REVIEW"
                          ? "Already lodged"
                          : "Not ready";
                  return (
                    <label
                      key={a.journeyId}
                      className={`flex items-center gap-2.5 rounded-sm px-2 py-1.5 ${eligibleRow ? "hover:bg-muted/50" : "opacity-60"}`}
                    >
                      <Checkbox
                        checked={selected.has(a.journeyId)}
                        disabled={!eligibleRow}
                        onCheckedChange={() => toggle(a.journeyId)}
                      />
                      <span className="flex-1 text-sm text-foreground">{a.fullName}</span>
                      {!eligibleRow && <span className="text-[11px] text-muted-foreground">{blocker}</span>}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground">Submission Owner *</label>
              <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="S. Rizna" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground">Internal Batch Reference *</label>
              <Input value={batchReference} onChange={(e) => setBatchReference(e.target.value)} placeholder="AUG-UMR-04-B02" />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-xs font-medium text-foreground">Submission Deadline</label>
              <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>

          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" />
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || !groupId || selected.size === 0 || !ownerName.trim() || !batchReference.trim()}>
            {isPending && <Loader2 className="animate-spin" />} Create Batch
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default CreateBatchSheet;
