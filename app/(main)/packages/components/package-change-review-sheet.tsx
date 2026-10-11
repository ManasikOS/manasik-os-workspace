"use client";

import { useState } from "react";
import { ShieldAlert, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { TONE_CLASS } from "@/lib/ui/tone";
import { groupChangesByTier, type PackageColumnChange } from "@/lib/packages/change-diff";

import PackageChangeDiffView from "./package-change-diff-view";

/**
 * The before / after comparison, in a side sheet, shown before a change to a package that is already on sale is saved (TASK-043).
 *
 * Display-only changes are listed but save at once. Payment, contract and booking changes are shown in full, need a written reason, and — unless the
 * agency has switched approval off for that kind of change — are sent to an administrator instead of going live. What this dialog says will happen is
 * only a preview: the database decides, from the same rules.
 */

export interface PackageApprovalPolicy {
  moneyAndContract: boolean;
  bookingsAndOperations: boolean;
}

interface PackageChangeReviewSheetProps {
  open: boolean;
  packageTitle: string;
  changes: PackageColumnChange[];
  /** `null` while it is still loading; the sheet then assumes approval is needed. */
  policy: PackageApprovalPolicy | null;
  /** Whether the person may change payment and booking terms at all (`editSensitiveTerms`). */
  canEditSensitiveTerms: boolean;
  /** Another change for this package is already waiting for approval. */
  pendingChangeExists: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: (input: { reason: string; supersedePending: boolean }) => void;
}

const MAX_REASON_LENGTH = 500;

export default function PackageChangeReviewSheet({
  open,
  packageTitle,
  changes,
  policy,
  canEditSensitiveTerms,
  pendingChangeExists,
  isSaving,
  onCancel,
  onConfirm,
}: PackageChangeReviewSheetProps) {
  const [reason, setReason] = useState("");
  const [supersedePending, setSupersedePending] = useState(false);

  const groups = groupChangesByTier(changes);
  const sensitiveCount = groups.moneyAndContract.length + groups.bookingsAndOperations.length;

  const moneyNeedsApproval = groups.moneyAndContract.length > 0 && (policy?.moneyAndContract ?? true);
  const operationsNeedApproval = groups.bookingsAndOperations.length > 0 && (policy?.bookingsAndOperations ?? true);
  const needsApproval = moneyNeedsApproval || operationsNeedApproval;
  const someApplyAtOnce =
    (groups.moneyAndContract.length > 0 && !moneyNeedsApproval) || (groups.bookingsAndOperations.length > 0 && !operationsNeedApproval);

  const trimmedReason = reason.trim();
  const reasonProblem =
    trimmedReason.length === 0 ? "Write why you are making this change." : trimmedReason.length > MAX_REASON_LENGTH ? `Keep it under ${MAX_REASON_LENGTH} characters.` : null;
  const blockedByPending = needsApproval && pendingChangeExists && !supersedePending;
  const canConfirm = canEditSensitiveTerms && !reasonProblem && !blockedByPending && !isSaving;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && !isSaving && onCancel()}>
      <SheetContent
        showCloseButton={false}
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl"
      >
        <SheetHeader className="border-b border-border/50 px-5 py-4">
          <SheetTitle>Review changes to {packageTitle || "this package"}</SheetTitle>
          <SheetDescription>
            This package is on sale. Changes to payment and booking terms are copied into every departure group created after they take effect, and they
            decide what leads and agents are quoted. Groups that already exist keep the terms they were created with.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 custom-scroll">
          {sensitiveCount > 0 ? (
            <div className={cn("flex items-start gap-2 rounded-sm px-3 py-2 text-xs", needsApproval ? TONE_CLASS.warning : TONE_CLASS.info)}>
              {needsApproval ? <ShieldAlert className="mt-0.5 size-3.5 shrink-0" /> : <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />}
              <span>
                {needsApproval
                  ? "An administrator must approve the payment and booking changes below before they take effect. The package stays as it is until then."
                  : "Your agency has switched approval off for these changes, so they take effect as soon as you confirm. They are recorded with your name and reason."}
                {needsApproval && someApplyAtOnce ? " Changes in the group that does not need approval take effect now." : ""}
              </span>
            </div>
          ) : null}

          {!canEditSensitiveTerms && sensitiveCount > 0 ? (
            <div className={cn("rounded-sm px-3 py-2 text-xs", TONE_CLASS.danger)}>
              Your role cannot change payment or booking terms of a package that is on sale. Go back and undo those changes, or ask someone who can.
            </div>
          ) : null}

          {groups.moneyAndContract.length > 0 ? (
            <ChangeGroup
              title="Money & contract"
              hint={policy?.moneyAndContract === false ? "Applies as soon as you confirm" : "Needs administrator approval"}
              changes={groups.moneyAndContract}
            />
          ) : null}
          {groups.bookingsAndOperations.length > 0 ? (
            <ChangeGroup
              title="Bookings & operations"
              hint={policy?.bookingsAndOperations === false ? "Applies as soon as you confirm" : "Needs administrator approval"}
              changes={groups.bookingsAndOperations}
            />
          ) : null}

          {groups.basic.length > 0 ? (
            <div className="rounded-sm border border-border/50 px-3 py-2.5">
              <p className="text-xs font-medium text-muted-foreground">Saved straight away (display text only)</p>
              <p className="mt-1 text-sm">{groups.basic.map((change) => change.label).join(", ")}</p>
            </div>
          ) : null}

          {sensitiveCount > 0 ? (
            <div className="space-y-3">
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>Reason for this change</InputGroupText>
                </InputGroupAddon>
                <InputGroupTextarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="For example: the airline changed its cancellation terms."
                  rows={3}
                  maxLength={MAX_REASON_LENGTH + 50}
                  aria-invalid={reason.length > 0 && !!reasonProblem}
                />
              </InputGroup>
              {reason.length > 0 && reasonProblem ? <p className="text-xs text-destructive">{reasonProblem}</p> : null}

              {needsApproval && pendingChangeExists ? (
                <label className="flex items-start gap-2 text-xs">
                  <Checkbox checked={supersedePending} onCheckedChange={(checked) => setSupersedePending(checked === true)} className="mt-0.5" />
                  <span>
                    Another change for this package is already waiting for approval. Tick this to replace it with the changes above; otherwise withdraw
                    the other one first.
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}
        </div>

        <SheetFooter className="border-t border-border/50 px-5 py-3">
          <Button variant="outline_without_border" onClick={onCancel} disabled={isSaving}>
            Keep editing
          </Button>
          <Button
            disabled={sensitiveCount > 0 ? !canConfirm : isSaving}
            onClick={() => onConfirm({ reason: trimmedReason, supersedePending })}
          >
            {isSaving ? "Saving…" : sensitiveCount === 0 ? "Save changes" : needsApproval ? "Send for approval" : "Confirm and apply"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ChangeGroup({ title, hint, changes }: { title: string; hint: string; changes: PackageColumnChange[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 border-b border-border/40 pb-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      {changes.map((change) => (
        <div key={change.column} className="rounded-sm border border-border/50 p-3">
          <PackageChangeDiffView label={change.label} before={change.before} after={change.after} />
        </div>
      ))}
    </div>
  );
}
