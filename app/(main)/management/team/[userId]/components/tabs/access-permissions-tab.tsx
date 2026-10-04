"use client";

import { Check, X } from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { describeRoleAccess } from "@/lib/access/team-access";
import type { TeamMemberProfile } from "@/lib/data/team";
import { TONE_TEXT } from "@/lib/ui/tone";
import type { TeamCapabilities } from "../../../types";
import ChangeRoleDialog from "../../../components/change-role-dialog";

interface AccessPermissionsTabProps {
  profile: TeamMemberProfile;
  can: TeamCapabilities;
  isSelf: boolean;
}

const AccessPermissionsTab = ({ profile, can, isSelf }: AccessPermissionsTabProps) => {
  const { member, recentRoleChanges } = profile;
  const [changeRoleOpen, setChangeRoleOpen] = useState(false);
  const summary = describeRoleAccess(member.role);

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-xs text-muted-foreground">Role</span>
            <p className="text-lg font-semibold text-foreground">{summary.label}</p>
          </div>
          {can.changeRole && !isSelf && (
            <Button variant="secondary" onClick={() => setChangeRoleOpen(true)}>
              Change Role
            </Button>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Can access</h3>
          <ul className="flex flex-col gap-1.5 mt-1">
            {summary.canAccess.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-foreground">
                <Check className={`size-3.5 shrink-0 ${TONE_TEXT.success}`} /> {item}
              </li>
            ))}
            {summary.canAccess.length === 0 && <li className="text-sm text-muted-foreground">Nothing beyond their own profile.</li>}
          </ul>
        </Card>
        <Card className="gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cannot access</h3>
          <ul className="flex flex-col gap-1.5 mt-1">
            {summary.cannotAccess.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                <X className="size-3.5 text-destructive shrink-0" /> {item}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {recentRoleChanges.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Recent role changes</h3>
          <div className="flex flex-col gap-2">
            {recentRoleChanges.map((entry) => (
              <Card key={entry.id} className="gap-1 py-3">
                <p className="text-sm text-foreground">
                  {entry.beforeRole && entry.afterRole
                    ? `${entry.actorName} changed the role from ${entry.beforeRole} to ${entry.afterRole}.`
                    : entry.message || "Role changed."}
                </p>
                <p className="text-[11px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      <ChangeRoleDialog
        member={{ id: member.id, fullName: member.fullName, role: member.role }}
        open={changeRoleOpen}
        onClose={() => setChangeRoleOpen(false)}
      />
    </div>
  );
};

export default AccessPermissionsTab;
