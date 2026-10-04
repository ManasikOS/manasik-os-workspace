"use client";

import { format } from "date-fns";
import { CalendarIcon, ChevronDown, Loader2 } from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { reactivateStaffAction } from "../actions";
import { useTeam } from "../team-store";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "../utils";
import { DatePicker } from "@/components/date-time-picker";
import { Card } from "@/components/ui/card";

const ROLES = Object.keys(ROLE_LABELS);
const EMPLOYMENT_TYPES = Object.keys(EMPLOYMENT_TYPE_LABELS);

interface InviteTeamMemberDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function InviteTeamMemberDialog({
  open,
  onClose,
}: InviteTeamMemberDialogProps) {
  const { inviteTeamMember, branchOptions } = useTeam();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("+94 ");
  const [role, setRole] = useState("OPERATIONS");
  const [branchId, setBranchId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [employmentType, setEmploymentType] = useState("PERMANENT");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWhatsapp, setSendWhatsapp] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // H3 of the remediation plan: a deactivated profile with this email used
  // to be a flat dead end. Set when inviteTeamMember() reports one, so the
  // dialog can offer a one-click "Reactivate instead" in its place.
  const [deactivatedStaffId, setDeactivatedStaffId] = useState<string | null>(
    null,
  );
  const [reactivating, setReactivating] = useState(false);

  const reset = () => {
    setFullName("");
    setEmail("");
    setWhatsapp("+94 ");
    setRole("OPERATIONS");
    // Default to the agency's primary branch when there is one, otherwise
    // the first active branch — never a hardcoded value (H2).
    setBranchId(branchOptions[0]?.id ?? "");
    setJobTitle("");
    setEmploymentType("PERMANENT");
    setStartDate("");
    setEndDate("");
    setSendEmail(true);
    setSendWhatsapp(false);
    setError(null);
    setFieldErrors({});
    setDeactivatedStaffId(null);
  };

  useResetOnOpen(open, "invite-team-member", reset);

  const isSeasonal = employmentType === "SEASONAL";
  const sendVia = [
    ...(sendEmail ? ["EMAIL"] : []),
    ...(sendWhatsapp ? ["WHATSAPP"] : []),
  ];
  const canSubmit =
    fullName.trim() &&
    email.trim() &&
    branchId &&
    sendVia.length > 0 &&
    (!isSeasonal || endDate) &&
    (!sendWhatsapp || whatsapp.replace(/\D/g, "").length > 0);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setDeactivatedStaffId(null);

    const result = await inviteTeamMember({
      fullName,
      email,
      whatsapp: whatsapp.trim() === "+94" ? "" : whatsapp,
      role: role as never,
      branchId,
      employmentType: employmentType as never,
      accessStartsOn: startDate || undefined,
      accessEndsOn: endDate || undefined,
      jobTitle: jobTitle.trim() || undefined,
      sendVia: sendVia as never,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not send the invitation.");
      setFieldErrors(result.fieldErrors ?? {});
      setDeactivatedStaffId(result.deactivatedStaffId ?? null);
      return;
    }

    toast.add({
      title: "Invitation sent",
      // `window.open()` here would run after this `await`, outside the
      // click that triggered it — every browser treats that as a popup and
      // blocks it silently (H7 of docs/modules/team-module-remediation-plan.md).
      // A real link inside the toast is a genuine click instead.
      description: result.whatsappShareUrl ? (
        <span>
          {fullName} will receive a secure setup link at {email}.{" "}
          <a
            href={result.whatsappShareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-foreground"
          >
            Open WhatsApp
          </a>
        </span>
      ) : (
        `${fullName} will receive a secure setup link at ${email}.`
      ),
    });
    reset();
    onClose();
  };

  const reactivateInstead = async () => {
    if (!deactivatedStaffId) return;
    setReactivating(true);
    const result = await reactivateStaffAction({ staffId: deactivatedStaffId });
    setReactivating(false);
    if (!result.ok) {
      setError(result.error ?? "Could not reactivate this account.");
      return;
    }
    toast.add({
      title: "Access restored",
      description: `${fullName || email} can sign in again.`,
    });
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl! gap-4 max-h-[90vh] overflow-y-auto custom-scroll">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            Grant access to the agency OS. Seasonal Guides need an end date so
            their access expires automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-5">
          <Field label="Full Name" required>
            <InputGroupInput
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Eg. Mohamed"
            />
            {fieldErrors.fullName && (
              <p className="text-xs text-destructive">{fieldErrors.fullName}</p>
            )}
          </Field>

          <Field label="Email" required>
            <InputGroupInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="username@yourdomain.com"
            />
            {fieldErrors.email && (
              <p className="text-xs text-destructive">{fieldErrors.email}</p>
            )}
          </Field>

          <Field label="WhatsApp / Mobile">
            <InputGroupInput
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+94 77 123 4567"
            />
            {fieldErrors.whatsapp && (
              <p className="text-xs text-destructive">{fieldErrors.whatsapp}</p>
            )}
          </Field>

          <Field label="Job Title">
            <InputGroupInput
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Senior Guide"
            />
          </Field>

          <SelectDropdown
            label="Role"
            value={role}
            onChange={setRole}
            options={ROLES.map((v) => ({
              value: v,
              label: ROLE_LABELS[v as keyof typeof ROLE_LABELS],
            }))}
          />

          <div>
            {branchOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No active branches configured for this agency yet — add one from
                Settings.
              </p>
            ) : (
              <SelectDropdown
                value={branchId}
                label="Branch"
                onChange={setBranchId}
                options={branchOptions.map((b) => ({
                  value: b.id,
                  label: `${b.name} (${b.code})`,
                }))}
              />
            )}
            {fieldErrors.branchId && (
              <p className="text-xs text-destructive">{fieldErrors.branchId}</p>
            )}
          </div>

          <SelectDropdown
            label="Employment Type"
            value={employmentType}
            onChange={setEmploymentType}
            options={EMPLOYMENT_TYPES.map((v) => ({
              value: v,
              label: EMPLOYMENT_TYPE_LABELS[v],
            }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <DatePicker
              label="Start Date"
              value={startDate}
              onChange={setStartDate}
              placeholder="Pick a date"
            />
            <div>
              <DatePicker
                label="End Date"
                value={endDate}
                onChange={setEndDate}
                placeholder="Pick a date"
              />
              {isSeasonal && !endDate && (
                <p className="text-[11px] text-muted-foreground">
                  Required for seasonal staff.
                </p>
              )}
              {fieldErrors.accessEndsOn && (
                <p className="text-xs text-destructive">
                  {fieldErrors.accessEndsOn}
                </p>
              )}
            </div>
          </div>

          <Card className="flex bg-transparent! col-span-2 flex-col gap-2 px-4 py-4">
            <label className="flex items-center gap-2  text-foreground cursor-pointer">
              <Checkbox
                checked={sendEmail}
                onCheckedChange={(c) => setSendEmail(c === true)}
              />
              Send invitation email
            </label>
            <label className="flex items-center gap-2  text-foreground cursor-pointer">
              <Checkbox
                checked={sendWhatsapp}
                onCheckedChange={(c) => setSendWhatsapp(c === true)}
              />
              Send invitation via WhatsApp
            </label>
            {fieldErrors.sendVia && (
              <p className="text-xs text-destructive">{fieldErrors.sendVia}</p>
            )}
          </Card>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {deactivatedStaffId && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={reactivateInstead}
              disabled={reactivating}
            >
              {reactivating && <Loader2 className="animate-spin" />} Reactivate
              this account instead
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !canSubmit}>
            {submitting && <Loader2 className="animate-spin" />} Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <InputGroup>
      <InputGroupAddon align={"block-start"}>
        <InputGroupText>
          {label} {required && <span className="text-destructive">*</span>}
        </InputGroupText>
      </InputGroupAddon>

      {children}
    </InputGroup>
  );
}

function SelectDropdown({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={"w-full"}>
        <InputGroup className="cursor-pointer w-full">
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>{label}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            readOnly
            value={selected?.label ?? ""}
            className="cursor-pointer"
          />
        </InputGroup>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-56 max-h-72 overflow-y-auto custom-scroll"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
