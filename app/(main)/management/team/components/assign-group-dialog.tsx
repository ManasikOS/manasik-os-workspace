"use client";

import { ChevronDown, Loader2, PlaneTakeoff, TriangleAlert } from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
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
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import { TONE_CLASS } from "@/lib/ui/tone";
import { assignGroupAction } from "../actions";
import { RESPONSIBILITY_LABELS, ROLE_LABELS } from "../utils";
import type { GroupPickerOption } from "../team-store";

const RESPONSIBILITIES = Object.keys(RESPONSIBILITY_LABELS);

/**
 * The role each responsibility is meant for. Not enforced server-side —
 * Operations legitimately holds every responsibility today — so this is a
 * soft warning, not a block: D10 of docs/modules/team-module-remediation-plan.md.
 * Roles absent from a list (ADMIN, CEO, OPERATIONS) are oversight/ops roles
 * that can reasonably hold anything, so they never warn.
 */
const EXPECTED_ROLES: Partial<Record<string, StaffRole[]>> = {
  PRIMARY_GUIDE: ["GUIDE", "ADMIN", "CEO", "OPERATIONS"],
  BACKUP_GUIDE: ["GUIDE", "ADMIN", "CEO", "OPERATIONS"],
  OPERATIONS_OWNER: ["OPERATIONS", "ADMIN", "CEO"],
  BACKUP_OPERATIONS: ["OPERATIONS", "ADMIN", "CEO"],
  VISA_OWNER: ["VISA", "ADMIN", "CEO", "OPERATIONS"],
  FINANCE_OWNER: ["FINANCE", "ADMIN", "CEO", "OPERATIONS"],
  MARKETING_OWNER: ["MARKETING", "ADMIN", "CEO", "OPERATIONS"],
};

export interface AssignGroupMemberRef {
  id: string;
  fullName: string;
  role: StaffRole;
}

interface AssignGroupDialogProps {
  member: AssignGroupMemberRef | null;
  groupOptions: GroupPickerOption[];
  onClose: () => void;
}

/**
 * Writes `staff_group_assignments` and, for the responsibilities with a
 * dedicated column, syncs `departure_groups` in the same call — see
 * `assignGroupToStaff()` in `lib/data/team-repository.ts`.
 */
export default function AssignGroupDialog({ member, groupOptions, onClose }: AssignGroupDialogProps) {
  const [departureGroupId, setDepartureGroupId] = useState("");
  const [responsibility, setResponsibility] = useState("OPERATIONS_OWNER");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(member !== null, member?.id ?? "", () => {
    setDepartureGroupId("");
    setResponsibility("OPERATIONS_OWNER");
    setError(null);
  });

  if (!member) return null;

  const selectedGroup = groupOptions.find((g) => g.id === departureGroupId);
  const expectedRoles = EXPECTED_ROLES[responsibility];
  const roleMismatch = expectedRoles && !expectedRoles.includes(member.role);

  const submit = async () => {
    setSubmitting(true);
    const result = await assignGroupAction({ staffId: member.id, departureGroupId, responsibility });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not assign the Departure Group.");
      return;
    }
    toast.add({
      title: "Group assigned",
      description: `${member.fullName} is now ${RESPONSIBILITY_LABELS[responsibility]} on ${selectedGroup?.groupName ?? "the group"}.`,
    });
    onClose();
  };

  return (
    <Dialog open={member !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <PlaneTakeoff className="size-5 text-primary" />
            <DialogTitle>Assign Departure Group</DialogTitle>
          </div>
          <DialogDescription>{member.fullName}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="Select group *">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <InputGroup className="cursor-pointer">
                  <InputGroupInput
                    readOnly
                    value={selectedGroup ? `${selectedGroup.groupName} (${selectedGroup.groupCode})` : ""}
                    placeholder="Choose a Departure Group"
                    className="cursor-pointer"
                  />
                  <ChevronDown className="size-4 text-muted-foreground mr-2" />
                </InputGroup>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-64 max-h-72 overflow-y-auto custom-scroll">
                {groupOptions.length === 0 && <DropdownMenuItem disabled>No open Departure Groups</DropdownMenuItem>}
                {groupOptions.map((g) => (
                  <DropdownMenuItem key={g.id} onClick={() => setDepartureGroupId(g.id)}>
                    {g.groupName} <span className="text-muted-foreground ml-1">{g.groupCode}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>

          <Field label="Assignment role *">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <InputGroup className="cursor-pointer">
                  <InputGroupInput readOnly value={RESPONSIBILITY_LABELS[responsibility]} className="cursor-pointer" />
                  <ChevronDown className="size-4 text-muted-foreground mr-2" />
                </InputGroup>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56">
                {RESPONSIBILITIES.map((r) => (
                  <DropdownMenuItem key={r} onClick={() => setResponsibility(r)}>
                    {RESPONSIBILITY_LABELS[r]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>

          {roleMismatch && (
            <div className={`flex items-start gap-2 rounded-md px-2.5 py-2 text-[11px] ${TONE_CLASS.warning}`}>
              <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
              <span>
                {member.fullName}&apos;s role is {ROLE_LABELS[member.role]}, not typically{" "}
                {RESPONSIBILITY_LABELS[responsibility]}. You can still assign this — double-check it&apos;s intended.
              </span>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !departureGroupId}>
            {submitting && <Loader2 className="animate-spin" />} Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
