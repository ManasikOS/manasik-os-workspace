"use client";

import { Loader2, ShieldCheck } from "lucide-react";
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
import { ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import type { StaffRole } from "@/lib/access/departure-groups-access";
import { changeStaffRoleAction } from "../actions";
import { ROLE_LABELS } from "../utils";

const ROLES = Object.keys(ROLE_LABELS) as StaffRole[];

export interface ChangeRoleMemberRef {
  id: string;
  fullName: string;
  role: StaffRole;
}

interface ChangeRoleDialogProps {
  member: ChangeRoleMemberRef | null;
  open: boolean;
  onClose: () => void;
}

export default function ChangeRoleDialog({ member, open, onClose }: ChangeRoleDialogProps) {
  const [role, setRole] = useState<StaffRole>("GUIDE");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, member?.id ?? "", () => {
    setRole(member?.role ?? "GUIDE");
    setError(null);
  });

  if (!member) return null;

  const submit = async () => {
    setSubmitting(true);
    const result = await changeStaffRoleAction({ staffId: member.id, role });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not change the role.");
      return;
    }
    toast.add({ title: "Role updated", description: `${member.fullName} is now ${ROLE_LABELS[role]}.` });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <ShieldCheck className="size-5 text-primary" />
            <DialogTitle>Change Role</DialogTitle>
          </div>
          <DialogDescription>{member.fullName} — this changes what they can access immediately.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {ROLES.map((option) => (
            <button key={option} type="button" onClick={() => setRole(option)}>
              <ToneBadge
                tone={role === option ? "brand" : "neutral"}
                label={ROLE_LABELS[option]}
                className={role === option ? "ring-2 ring-primary/40" : "opacity-60"}
              />
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || role === member.role}>
            {submitting && <Loader2 className="animate-spin" />} Save Role Change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
