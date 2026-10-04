"use client";

import { ChevronDown, Loader2, UserRoundCog } from "lucide-react";
import React, { useState } from "react";

import { DatePicker } from "@/components/date-time-picker";
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
} from "@/components/ui/input-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { updateStaffProfileAction } from "../actions";
import type { BranchPickerOption } from "../team-store";
import { EMPLOYMENT_TYPE_LABELS } from "../utils";

const EMPLOYMENT_TYPES = Object.keys(EMPLOYMENT_TYPE_LABELS);

export interface EditProfileMemberRef {
  id: string;
  fullName: string;
  whatsapp: string | null;
  jobTitle: string | null;
  branch: string;
  employmentType: string;
  accessStartsOn: string | null;
  accessEndsOn: string | null;
}

interface EditProfileSheetProps {
  member: EditProfileMemberRef | null;
  branchOptions: BranchPickerOption[];
  onClose: () => void;
}

/**
 * Admin-only (`can.editProfile` — `lib/access/team-access.ts`). Writes
 * `full_name`, `whatsapp`, `job_title`, `branch`/`branch_id`,
 * `employment_type`, `access_starts_on` and `access_ends_on` through
 * `updateStaffProfileAction`. Role and account status change from their own
 * dedicated flows (Change Role, Deactivate/Reactivate), not here — C2 of
 * docs/modules/team-module-remediation-plan.md.
 */
export default function EditProfileSheet({
  member,
  branchOptions,
  onClose,
}: EditProfileSheetProps) {

  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [branchId, setBranchId] = useState("");
  const [employmentType, setEmploymentType] = useState("PERMANENT");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useResetOnOpen(member !== null, member?.id ?? "", () => {
    setFullName(member?.fullName ?? "");
    setWhatsapp(member?.whatsapp ?? "");
    setJobTitle(member?.jobTitle ?? "");
    setBranchId(
      branchOptions.find((b) => b.name === member?.branch)?.id ??
        branchOptions[0]?.id ??
        "",
    );
    setEmploymentType(member?.employmentType ?? "PERMANENT");
    setStartDate(member?.accessStartsOn ?? "");
    setEndDate(member?.accessEndsOn ?? "");
    setError(null);
    setFieldErrors({});
  });

  const isSeasonal = employmentType === "SEASONAL";
  const canSubmit = fullName.trim().length > 0 && (!isSeasonal || endDate);
  const selectedBranch = branchOptions.find((b) => b.id === branchId);

  const submit = async () => {
    if (!member) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const result = await updateStaffProfileAction({
      staffId: member.id,
      fullName,
      whatsapp,
      jobTitle,
      branchId: branchId || undefined,
      employmentType,
      accessStartsOn: startDate || null,
      accessEndsOn: endDate || null,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save these changes.");
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    toast.add({
      title: "Profile updated",
      description: `${fullName || member.fullName}'s profile was saved.`,
    });
    onClose();
  };

  if (!member) return null;

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-md w-full p-0 gap-0"
      >
        <SheetHeader>
          <SheetTitle>Edit Profile</SheetTitle>

          <SheetDescription className="mt-1">
            {member?.fullName} — role and account status change from their own
            actions, not here.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto custom-scroll px-4 py-4 flex flex-col gap-3">
          <Field label="Full Name">
            <InputGroupInput
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
            {fieldErrors.fullName && (
              <p className="text-xs text-destructive">{fieldErrors.fullName}</p>
            )}
          </Field>

          <Field label="WhatsApp / Mobile">
            <InputGroupInput
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+94 77 123 4567"
            />
          </Field>

          <Field label="Job Title">
            <InputGroupInput
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Senior Guide"
            />
          </Field>

          <Field label="Branch">
            {branchOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No active branches configured for this agency — currently:{" "}
                {member.branch}.
              </p>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup className="cursor-pointer">
                    <InputGroupInput
                      readOnly
                      value={
                        selectedBranch
                          ? `${selectedBranch.name} (${selectedBranch.code})`
                          : member.branch
                      }
                      className="cursor-pointer"
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="min-w-56 max-h-72 overflow-y-auto custom-scroll"
                >
                  {branchOptions.map((b) => (
                    <DropdownMenuItem
                      key={b.id}
                      onClick={() => setBranchId(b.id)}
                    >
                      {b.name}{" "}
                      <span className="text-muted-foreground ml-1">
                        {b.code}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </Field>

          <Field label="Employment Type">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <InputGroup className="cursor-pointer">
                  <InputGroupInput
                    readOnly
                    value={EMPLOYMENT_TYPE_LABELS[employmentType]}
                    className="cursor-pointer"
                  />
                  <ChevronDown className="size-4 text-muted-foreground mr-2" />
                </InputGroup>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {EMPLOYMENT_TYPES.map((v) => (
                  <DropdownMenuItem
                    key={v}
                    onClick={() => setEmploymentType(v)}
                  >
                    {EMPLOYMENT_TYPE_LABELS[v]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <DatePicker
              label="Access Starts"
              value={startDate}
              onChange={setStartDate}
              placeholder="Pick a date"
            />
            <DatePicker
              label={isSeasonal ? "Access Ends *" : "Access Ends"}
              value={endDate}
              onChange={setEndDate}
              placeholder="Pick a date"
            />
          </div>
          {isSeasonal && !endDate && (
            <p className="text-[11px] text-muted-foreground -mt-1.5">
              Required for seasonal staff.
            </p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border/40">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !canSubmit}>
            {submitting && <Loader2 className="animate-spin" />} Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <InputGroup>
      <InputGroupAddon align={"block-start"}>
        <InputGroupText>{label}</InputGroupText>
      </InputGroupAddon>
      {children}
    </InputGroup>
  );
}
