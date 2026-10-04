"use client";

import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  MinusCircle,
  TriangleAlert,
} from "lucide-react";
import React, { useState, useTransition } from "react";

import { updateReadinessItemAction } from "../../actions";
import {
  PersonChip,
  ReadinessItemStatusBadge,
} from "../../components/status-badges";
import type {
  DepartureGroupReadinessItem,
  ReadinessItemStatus,
} from "../../types";
import {
  READINESS_ITEM_STATUS_LABELS,
  formatDate,
  formatDateTime,
} from "../../utils";
import { DatePicker } from "@/components/date-time-picker";

interface ReadinessItemDrawerProps {
  item: DepartureGroupReadinessItem | null;
  canEdit: boolean;
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  FLIGHT: "Flight",
  HOTEL: "Hotel",
  TRANSPORT: "Transport",
  PAYMENT: "Payment",
  DOCUMENT: "Document",
  VISA: "Visa",
  ROOMING: "Rooming",
  GUIDE: "Guide",
  MANIFEST: "Manifest",
  CATERING: "Catering",
  OTHER: "Other",
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  OPERATIONS: "Operations",
  VISA: "Visa",
  FINANCE: "Finance",
  GUIDE: "Guide",
  MARKETING: "Marketing",
};

const STATUS_OPTIONS: ReadinessItemStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "AT_RISK",
  "BLOCKED",
  "COMPLETE",
];

/** "2026-09-20T14:30:00.000Z" -> "2026-09-20T14:30" in the browser's local time. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "2026-09-20T14:30" (local) -> a real ISO string, or null if empty/invalid. */
function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="text-sm text-foreground text-right min-w-0">{value}</div>
    </div>
  );
}

/**
 * Focused editing for a single readiness requirement. Kept in a drawer so the
 * checklist stays a scannable table and long forms never render inline.
 *
 * Every field writes through one action, so the three quick verdicts in the
 * footer — complete, blocked, not required — are the same mutation as a manual
 * save and land on the activity trail identically. The group's readiness score
 * is derived from these rows on read, so it moves as soon as the page refreshes.
 */
const ReadinessItemDrawer = ({
  item,
  canEdit,
  open,
  onClose,
}: ReadinessItemDrawerProps) => {
  const [isPending, startTransition] = useTransition();

  const [status, setStatus] = useState<ReadinessItemStatus>(
    item?.status ?? "NOT_STARTED",
  );
  const [assignedToName, setAssignedToName] = useState(
    item?.assignedToName ?? "",
  );
  const [dueAt, setDueAt] = useState(toLocalInputValue(item?.dueAt ?? null));
  const [evidenceUrl, setEvidenceUrl] = useState(item?.evidenceUrl ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  // The drawer stays mounted between opens (so it can animate), so the form
  // has to re-sync from `item` each time it opens rather than only on first
  // mount.
  useResetOnOpen(open, item?.id ?? "", () => {
    setStatus(item?.status ?? "NOT_STARTED");
    setAssignedToName(item?.assignedToName ?? "");
    setDueAt(toLocalInputValue(item?.dueAt ?? null));
    setEvidenceUrl(item?.evidenceUrl ?? "");
    setNotes(item?.notes ?? "");
    setError(null);
  });

  /**
   * Sends the edit. `overrides` lets the footer verdicts commit a status
   * without first requiring the operator to also press Save.
   */
  const submit = (
    overrides?: { status?: ReadinessItemStatus; required?: boolean },
    successTitle = "Requirement updated",
  ) => {
    setError(null);

    if (!item) return;

    const trimmedEvidence = evidenceUrl.trim();
    if (trimmedEvidence && !/^https?:\/\//i.test(trimmedEvidence)) {
      setError("Evidence must be a full URL starting with http:// or https://");
      return;
    }

    const payload = {
      id: item.id,
      departureGroupId: item.departureGroupId,
      status: overrides?.status ?? status,
      assignedToName: assignedToName.trim() || null,
      dueAt: fromLocalInputValue(dueAt),
      evidenceUrl: trimmedEvidence || null,
      notes: notes.trim() || null,
      ...(overrides?.required !== undefined
        ? { required: overrides.required }
        : {}),
    };

    startTransition(async () => {
      const result = await updateReadinessItemAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: successTitle,
        description: `${result.label} · ${READINESS_ITEM_STATUS_LABELS[result.status]}`,
      });
      onClose();
    });
  };

  /**
   * "Not Required" also clears the required flag in the same write — the server
   * refuses to park a required item otherwise, and asking the operator to flip
   * two things to express one decision is busywork.
   */
  const markNotRequired = () =>
    submit(
      { status: "NOT_REQUIRED", required: false },
      "Requirement marked not required",
    );

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-md w-full p-0 gap-0"
      >
        <SheetHeader>
          <SheetTitle className="text-xl pr-8">{item?.label}</SheetTitle>
          <SheetDescription className="mt-1">
            {item && CATEGORY_LABELS[item.category]} requirement ·{" "}
            {item?.required ? "Required" : "Optional"}
          </SheetDescription>
          <div className="mt-3">
            {item && <ReadinessItemStatusBadge value={item.status} />}
          </div>
        </SheetHeader>

        {item && (
          <div className="flex-1 overflow-y-auto custom-scroll px-4 py-4">
            <div className="divide-y divide-border/10">
              <Row
                label="Category"
                value={
                  <Badge
                    variant="outline"
                    className="text-[10px] text-muted-foreground"
                  >
                    {CATEGORY_LABELS[item.category]}
                  </Badge>
                }
              />
              <Row
                label="Responsible role"
                value={ROLE_LABELS[item.responsibleRole]}
              />
              <Row label="Due timing" value={item.dueLabel} />
              <Row
                label="Linked template requirement"
                value={
                  <span className="font-number text-xs text-muted-foreground">
                    {item.sourceTemplateRequirementId ?? "Added manually"}
                  </span>
                }
              />
              {item.completedAt && (
                <Row
                  label="Completed"
                  value={
                    <span className="text-xs">
                      {formatDateTime(item.completedAt)}
                      {item.completedBy && (
                        <span className="block text-muted-foreground">
                          by {item.completedBy}
                        </span>
                      )}
                    </span>
                  }
                />
              )}
              {!canEdit && (
                <>
                  <Row
                    label="Assigned to"
                    value={<PersonChip name={item.assignedToName} />}
                  />
                  <Row
                    label="Due date"
                    value={
                      item.dueAt ? formatDate(item.dueAt) : "Not date-bound"
                    }
                  />
                  <Row
                    label="Evidence"
                    value={
                      item.evidenceUrl ? (
                        <a
                          href={item.evidenceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <FileText className="size-3.5" /> View confirmation
                        </a>
                      ) : (
                        <span className="text-muted-foreground">
                          Not uploaded
                        </span>
                      )
                    }
                  />
                </>
              )}
            </div>

            {canEdit ? (
              <div className="flex flex-col mt-3 gap-6">
                <div className="flex flex-col gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <InputGroup>
                        <InputGroupAddon align={"block-start"}>
                          <InputGroupText>Status</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput
                          readOnly
                          value={READINESS_ITEM_STATUS_LABELS[status]}
                        />
                      </InputGroup>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-48">
                      {STATUS_OPTIONS.map((option) => (
                        <DropdownMenuItem
                          key={option}
                          onClick={() => setStatus(option)}
                        >
                          {READINESS_ITEM_STATUS_LABELS[option]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Assigned to</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={assignedToName}
                    onChange={(event) => setAssignedToName(event.target.value)}
                    placeholder={`Unassigned · ${ROLE_LABELS[item.responsibleRole]} owns this`}
                  />
                </InputGroup>

                <div className="flex flex-col gap-1.5">
                  <DatePicker
                    label="Due Date"
                    onChange={(e) => setDueAt(e)}
                    value={dueAt}
                    placeholder="Set Due Date"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {item.dueLabel}. Clearing this makes the requirement
                    open-ended.
                  </span>
                </div>

                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Evidence URL</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    value={evidenceUrl}
                    onChange={(event) => setEvidenceUrl(event.target.value)}
                    placeholder="https://drive.example.com/confirmation.pdf"
                  />
                </InputGroup>

                <InputGroup className="overflow-hidden">
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Notes</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupTextarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Add context for whoever picks this up next…"
                    rows={4}
                    className="max-h-32 overflow-y-auto"
                  />
                </InputGroup>

                {error && (
                  <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-foreground">
                  Notes
                </span>
                <p className="text-sm text-muted-foreground">
                  {item.notes || "No notes recorded."}
                </p>
              </div>
            )}

            <Separator className="my-4" />

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-foreground">
                Activity history
              </span>
              <div className="flex items-start gap-2.5">
                <CalendarClock className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  {item.sourceTemplateRequirementId
                    ? "Copied from the package snapshot when this group was created."
                    : "Added manually to this group."}
                  {item.completedAt &&
                    ` Marked complete on ${formatDate(item.completedAt)}.`}
                </p>
              </div>
            </div>
          </div>
        )}

        {item && canEdit && (
          <SheetFooter className="border-t border-border/40 gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={markNotRequired}
              >
                <MinusCircle /> Not Required
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending || item.status === "BLOCKED"}
                onClick={() =>
                  submit({ status: "BLOCKED" }, "Requirement marked blocked")
                }
              >
                <Ban /> Mark Blocked
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isPending || item.status === "COMPLETE"}
                onClick={() =>
                  submit({ status: "COMPLETE" }, "Requirement completed")
                }
              >
                <CheckCircle2 /> Mark Complete
              </Button>
              <Button size="sm" disabled={isPending} onClick={() => submit()}>
                {isPending && <Loader2 className="animate-spin" />}
                Save Changes
              </Button>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default ReadinessItemDrawer;
