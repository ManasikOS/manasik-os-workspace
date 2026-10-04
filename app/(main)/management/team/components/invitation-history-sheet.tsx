"use client";

import {
  CalendarClock,
  Loader2,
  MailQuestion,
  RotateCw,
  XCircle,
} from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";

import { invitationStatusTone } from "@/lib/data/team";
import { useTeam } from "../team-store";
import { branchLabel, EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "../utils";
import { Card } from "@/components/ui/card";

interface InvitationHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const InvitationHistorySheet = ({
  open,
  onOpenChange,
}: InvitationHistorySheetProps) => {
  const { invitationHistory, resendInvitation, revokeInvitation } = useTeam();
  const [busyId, setBusyId] = useState<string | null>(null);

  const runResend = async (staffId: string) => {
    setBusyId(staffId);
    const result = await resendInvitation(staffId);
    setBusyId(null);
    if (!result.ok) {
      toast.add({
        title: "Could not resend invitation",
        description: result.error,
      });
      return;
    }
    // A `window.open()` here would run after the `await` above, outside the
    // click that triggered it — every browser treats that as a popup and
    // blocks it silently (H7 of docs/modules/team-module-remediation-plan.md). A
    // real link inside the toast is a genuine click instead.
    toast.add({
      title: "Invitation resent",
      description: result.whatsappShareUrl ? (
        <a
          href={result.whatsappShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-foreground"
        >
          Open WhatsApp
        </a>
      ) : undefined,
    });
  };

  const runRevoke = async (staffId: string) => {
    setBusyId(staffId);
    const result = await revokeInvitation(staffId);
    setBusyId(null);
    if (!result.ok) {
      toast.add({
        title: "Could not revoke invitation",
        description: result.error,
      });
      return;
    }
    toast.add({ title: "Invitation revoked" });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-md w-full p-0 gap-0"
      >
        <SheetHeader>
          <SheetTitle>Invitation History</SheetTitle>
          <SheetDescription className="mt-1">
            Every invitation sent, including resends. A resend creates a new
            entry so the history stays accurate.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto custom-scroll px-4 py-4">
          {invitationHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <MailQuestion className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">
                No invitations sent yet
              </p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Invite a team member from the Team list to see their invitation
                here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {invitationHistory.map((invitation) => (
                <Card key={invitation.id} className=" px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {invitation.staffFullName || invitation.email}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {invitation.email}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <ToneBadge
                          tone="neutral"
                          label={ROLE_LABELS[invitation.role]}
                        />
                        <ToneBadge
                          tone="neutral"
                          label={branchLabel(invitation.branch)}
                        />
                        <ToneBadge
                          tone="neutral"
                          label={
                            EMPLOYMENT_TYPE_LABELS[invitation.employmentType]
                          }
                        />
                      </div>
                    </div>
                    <ToneBadge
                      tone={invitationStatusTone(invitation.status)}
                      label={invitation.status}
                    />
                  </div>

                  <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5">
                    <CalendarClock className="size-3" />
                    Sent {new Date(
                      invitation.createdAt,
                    ).toLocaleDateString()}{" "}
                    by {invitation.invitedByName ?? "System"} · via{" "}
                    {invitation.sentVia
                      .map((c) => c.charAt(0) + c.slice(1).toLowerCase())
                      .join(", ")}
                  </p>

                  {invitation.status === "PENDING" && (
                    <div className="flex items-center justify-end gap-2 mt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={busyId === invitation.staffId}
                        onClick={() => runRevoke(invitation.staffId)}
                      >
                        {busyId === invitation.staffId ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <XCircle />
                        )}
                        Revoke
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyId === invitation.staffId}
                        onClick={() => runResend(invitation.staffId)}
                      >
                        {busyId === invitation.staffId ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <RotateCw />
                        )}
                        Resend
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default InvitationHistorySheet;
