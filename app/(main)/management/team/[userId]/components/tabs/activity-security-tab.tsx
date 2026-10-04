"use client";

import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";

import { formatLastActive } from "@/lib/data/team";
import type { TeamMemberProfile } from "@/lib/data/team";
import type { MergedActivityRow } from "@/lib/data/team-repository";
import { revokeSessionsAction, sendPasswordResetAction } from "../../../actions";
import type { TeamCapabilities } from "../../../types";

interface ActivitySecurityTabProps {
  profile: TeamMemberProfile;
  nowIso: string;
  can: TeamCapabilities;
  isSelf: boolean;
  activity: MergedActivityRow[];
  hasAdminClient: boolean;
}

const ActivitySecurityTab = ({ profile, nowIso, can, activity, hasAdminClient }: ActivitySecurityTabProps) => {
  const { member } = profile;
  const [sendingReset, setSendingReset] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const sendReset = async () => {
    setSendingReset(true);
    const result = await sendPasswordResetAction({ staffId: member.id });
    setSendingReset(false);
    if (!result.ok) {
      toast.add({ title: "Could not send reset link", description: result.error });
      return;
    }
    toast.add({ title: "Password reset link sent", description: `Sent to ${member.email}.` });
  };

  const revoke = async () => {
    setRevoking(true);
    const result = await revokeSessionsAction({ staffId: member.id });
    setRevoking(false);
    if (!result.ok) {
      toast.add({ title: "Could not revoke sessions", description: result.error });
      return;
    }
    toast.add({ title: "Sessions revoked", description: `${member.fullName} was signed out everywhere.` });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Recent Activity</h3>
        {activity.length === 0 ? (
          <EmptyState title="No activity recorded yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {activity.map((event) => (
              <Card key={`${event.source}-${event.id}`} className="gap-1 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-foreground">
                    {/* Every message built in lib/data/team-repository.ts already opens with
                        the actor's name ("X changed the role…", "X assigned…") — prefixing it
                        again duplicated the name on nearly every row (D3 of the remediation
                        plan). The one exception is a system-authored message ("Invitation
                        accepted — account activated."), which still needs the prefix. */}
                    {event.message.startsWith(event.actorName) ? event.message : `${event.actorName} ${event.message}`}
                    {event.groupName && <span className="text-muted-foreground"> — {event.groupName}</span>}
                  </p>
                  {event.isHighImpact && <ToneBadge tone="warning" label="High impact" className="shrink-0" />}
                </div>
                <p className="text-[11px] text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {can.viewSecurityTab && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Security</h3>
          <Card className="gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Last login</span>
                <span className="text-sm text-foreground">{formatLastActive(member, nowIso)}</span>
              </div>
              {!hasAdminClient && (
                <div className="flex items-start gap-2 sm:col-span-2 rounded-md bg-muted/40 px-3 py-2">
                  <ShieldAlert className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground">
                    Active sessions and 2FA status require the deployment&apos;s service-role key, which is not configured —
                    see <code>SUPABASE_SECRET_KEY</code> in the Team build plan.
                  </p>
                </div>
              )}
            </div>

            {can.manageSessionsAndPasswords && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40">
                <Button variant="outline" size="sm" onClick={sendReset} disabled={sendingReset}>
                  <KeyRound className="size-3.5" /> {sendingReset ? "Sending…" : "Reset Password"}
                </Button>
                {hasAdminClient && (
                  <Button variant="outline" size="sm" className="text-destructive" onClick={revoke} disabled={revoking}>
                    <ShieldCheck className="size-3.5" /> {revoking ? "Revoking…" : "Revoke Sessions"}
                  </Button>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default ActivitySecurityTab;
