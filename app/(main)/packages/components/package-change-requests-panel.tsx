"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Clock, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { ToneBadge } from "@/components/ui/tone-badge";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { runWithLoadingToast, toast } from "@/components/ui/toast";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import type { PackageCapabilities } from "@/lib/access/packages-access";
import { PACKAGE_TIER_LABELS } from "@/lib/access/package-field-tiers";
import type { PackageChangeRequest } from "@/lib/data/packages-repository";
import { PACKAGE_COLUMN_LABELS } from "@/lib/packages/change-diff";
import type { PackageContentColumn } from "@/lib/access/package-field-tiers";

import { decidePackageChangeAction, withdrawPackageChangeAction } from "../actions";
import PackageChangeDiffView from "./package-change-diff-view";

/**
 * Changes to a package that is on sale, waiting for an administrator's approval (TASK-043).
 *
 * Shown on the package's page. The person who asked can withdraw it; a person with `approvePackageChanges` who did not ask can approve it or reject
 * it with a note. The database enforces all of that again (including "never your own request" and "the package has not changed since").
 */

interface PackageChangeRequestsPanelProps {
  requests: PackageChangeRequest[];
  can: Pick<PackageCapabilities, "approvePackageChanges" | "editPackage">;
  currentUserId: string | null;
  /** Show the package name above each request (for a list that spans packages). */
  showPackageName?: boolean;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
}

export default function PackageChangeRequestsPanel({ requests, can, currentUserId, showPackageName = false }: PackageChangeRequestsPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState<PackageChangeRequest | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  if (requests.length === 0) return null;

  const approve = (request: PackageChangeRequest) =>
    startTransition(async () => {
      const result = await runWithLoadingToast(() => decidePackageChangeAction({ requestId: request.id, approve: true }), {
        loadingTitle: "Approving change…",
        successTitle: "Change approved",
        errorTitle: "Could not approve the change",
        getFailureMessage: (response) => (response.ok ? undefined : response.error),
        shouldDismissSilently: (response) => response.ok,
      });
      if (!result?.ok) return;
      toast.add(
        result.status === "EXPIRED"
          ? { title: "That request had expired", description: "Ask for the change to be submitted again." }
          : { title: "Change approved", description: "It now applies to the package." },
      );
      router.refresh();
    });

  const reject = () => {
    const request = rejecting;
    if (!request) return;
    startTransition(async () => {
      const result = await runWithLoadingToast(() => decidePackageChangeAction({ requestId: request.id, approve: false, note: rejectNote }), {
        loadingTitle: "Rejecting change…",
        successTitle: "Change rejected",
        errorTitle: "Could not reject the change",
        getFailureMessage: (response) => (response.ok ? undefined : response.error),
      });
      if (!result?.ok) return;
      setRejecting(null);
      setRejectNote("");
      router.refresh();
    });
  };

  const withdraw = (request: PackageChangeRequest) =>
    startTransition(async () => {
      const result = await runWithLoadingToast(() => withdrawPackageChangeAction({ requestId: request.id }), {
        loadingTitle: "Withdrawing change…",
        successTitle: "Change withdrawn",
        errorTitle: "Could not withdraw the change",
        getFailureMessage: (response) => (response.ok ? undefined : response.error),
      });
      if (result?.ok) router.refresh();
    });

  return (
    <div className="flex flex-col gap-4" aria-label="Changes waiting for approval">
      {requests.map((request) => {
        const isMine = request.requestedBy !== null && request.requestedBy === currentUserId;
        const canDecide = can.approvePackageChanges && !isMine;
        const canWithdraw = isMine || can.approvePackageChanges;
        const columns = Object.entries(request.changes);

        return (
          <Card key={request.id} className="gap-4 border border-border/60 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldAlert className={cn("size-4", TONE_TEXT.warning)} aria-hidden />
                  {showPackageName ? (
                    <Link href={`/packages/${request.packageId}`} className="hover:underline">
                      {request.packageTitle}
                    </Link>
                  ) : null}
                  {showPackageName ? " · " : ""}Change waiting for approval
                </p>
                <p className="text-xs text-muted-foreground">
                  Requested by {request.requestedByName} on {formatWhen(request.createdAt)} ·{" "}
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" aria-hidden /> {daysLeft(request.expiresAt)} day{daysLeft(request.expiresAt) === 1 ? "" : "s"} left
                  </span>
                </p>
              </div>
              <ToneBadge tone="warning" label={PACKAGE_TIER_LABELS[request.highestTier]} />
            </div>

            <div className="rounded-sm bg-muted/50 px-3 py-2 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Reason: </span>
              {request.reason}
            </div>

            <div className="space-y-3">
              {columns.map(([column, change]) => (
                <div key={column} className="rounded-sm border border-border/50 p-3">
                  <PackageChangeDiffView
                    label={PACKAGE_COLUMN_LABELS[column as PackageContentColumn] ?? column}
                    before={change.old}
                    after={change.new}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {isMine && !canDecide ? (
                <span className="me-auto text-xs text-muted-foreground">You asked for this change, so someone else has to approve it.</span>
              ) : null}
              {canWithdraw ? (
                <Button variant="outline_without_border" size="sm" disabled={isPending} onClick={() => withdraw(request)}>
                  Withdraw
                </Button>
              ) : null}
              {canDecide ? (
                <>
                  <Button variant="outline_without_border" size="sm" disabled={isPending} onClick={() => setRejecting(request)}>
                    Reject
                  </Button>
                  <Button size="sm" disabled={isPending} onClick={() => approve(request)}>
                    Approve
                  </Button>
                </>
              ) : null}
            </div>
          </Card>
        );
      })}

      <Dialog open={rejecting !== null} onOpenChange={(next) => !next && !isPending && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject this change?</DialogTitle>
            <DialogDescription>
              The package stays as it is. {rejecting?.requestedByName ?? "The person who asked"} will see your note on the package&apos;s activity.
            </DialogDescription>
          </DialogHeader>
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Why is it rejected?</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} rows={3} maxLength={500} />
          </InputGroup>
          <DialogFooter>
            <Button variant="outline_without_border" disabled={isPending} onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={isPending || rejectNote.trim().length === 0} onClick={reject}>
              Reject change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
