"use client";

import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { ROLE_LABELS, type StaffRole } from "@/lib/access/departure-groups-access";
import type { StaffSessionRow } from "@/lib/data/settings-repository";

import { revokeSessionsAction } from "../../team/actions";
import { SectionShell } from "../components/section-shell";
import { UnavailableNote } from "../components/unavailable-note";

export function SessionsCard({
  staff,
  currentStaffId,
  canManage,
}: {
  staff: StaffSessionRow[];
  currentStaffId: string | null;
  canManage: boolean;
}) {
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const revoke = async (staffId: string) => {
    setRevokingId(staffId);
    const result = await revokeSessionsAction({ staffId });
    setRevokingId(null);

    if (!result.ok) {
      toast.add({ title: "Could not revoke sessions", description: result.error });
      return;
    }
    toast.add({ title: "Sessions revoked" });
  };

  return (
    <SectionShell title="Session control" description="Active staff, most recently active first.">
      <UnavailableNote reason="Device and location are not shown — auth.sessions is not readable from this application. This lists people, not individual sessions." />

      <Card className="p-0 overflow-hidden">
        <div className="divide-y divide-border/20">
          {staff.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground">
                  {member.full_name}
                  {member.id === currentStaffId && <span className="text-muted-foreground"> (you)</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ROLE_LABELS[member.role as StaffRole] ?? member.role} · Last active:{" "}
                  {member.last_active_at
                    ? formatDistanceToNow(new Date(member.last_active_at), { addSuffix: true })
                    : "Never"}
                </span>
              </div>
              {canManage && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={revokingId === member.id}
                  onClick={() => revoke(member.id)}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
          {staff.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">No active staff.</div>
          )}
        </div>
      </Card>
    </SectionShell>
  );
}
