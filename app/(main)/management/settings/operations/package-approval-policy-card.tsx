"use client";

import { useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";

import SectionHeading from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { runWithLoadingToast } from "@/components/ui/toast";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { cn } from "@/lib/utils";
import { TONE_CLASS } from "@/lib/ui/tone";

import { updatePackageApprovalPolicyAction } from "../actions";
import { SettingToggleRow } from "../components/setting-toggle-row";

/**
 * Settings → Operations → Package change approval (TASK-043).
 *
 * A package that is on sale feeds the payment schedule and terms of every departure group created afterwards. Changing those terms shows a before /
 * after comparison to whoever makes the change, always. These two switches decide whether an administrator must also approve it before it takes effect.
 * Both start ON. Turning one off does not skip the comparison, the reason or the record.
 */
export function PackageApprovalPolicyCard({
  moneyAndContract,
  bookingsAndOperations,
  approverCount,
  canEdit,
}: {
  moneyAndContract: boolean;
  bookingsAndOperations: boolean;
  /** Active administrators, the people who can approve by default. */
  approverCount: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [money, setMoney] = useState(moneyAndContract);
  const [operations, setOperations] = useState(bookingsAndOperations);

  const dirty = money !== moneyAndContract || operations !== bookingsAndOperations;
  const loosening = (!money && moneyAndContract) || (!operations && bookingsAndOperations);

  const save = () =>
    startTransition(async () => {
      const result = await runWithLoadingToast(() => updatePackageApprovalPolicyAction({ moneyAndContract: money, bookingsAndOperations: operations }), {
        loadingTitle: "Saving approval policy…",
        successTitle: "Approval policy saved",
        errorTitle: "Could not save the approval policy",
        getFailureMessage: (response) => (response.ok ? undefined : (response.error ?? "Something went wrong.")),
      });
      if (result?.ok) router.refresh();
    });

  return (
    <Card className="gap-3 px-5 py-5">
      <SectionHeading title="Package change approval" />
      <p className="text-xs leading-relaxed text-muted-foreground">
        When someone changes a package that is already on sale, they see what will change and must say why. These switches decide whether an administrator
        must also approve the change before it takes effect. Display-only changes, such as the package name or wording, never need approval.
      </p>

      <div className="flex flex-col divide-y divide-border/20">
        <SettingToggleRow
          label="Require approval for payment and contract changes"
          description="Payment milestones, payment terms, cancellation policy, late-payment policy and the price-change disclaimer. These become the payment schedule and terms of every new departure group."
          checked={money}
          onCheckedChange={setMoney}
          disabled={!canEdit || isPending}
        />
        <SettingToggleRow
          label="Require approval for booking and operations changes"
          description="Capacity, group size, duration, accommodation, transport, inclusions and exclusions, document and readiness requirements, package code and visibility."
          checked={operations}
          onCheckedChange={setOperations}
          disabled={!canEdit || isPending}
        />
      </div>

      {loosening ? (
        <div className={cn("flex items-start gap-2 rounded-sm px-3 py-2 text-xs", TONE_CLASS.warning)}>
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            With approval off, these changes take effect as soon as the person confirms them. They are still recorded with their name and reason.
          </span>
        </div>
      ) : null}

      {(money || operations) && approverCount < 2 ? (
        <div className={cn("flex items-start gap-2 rounded-sm px-3 py-2 text-xs", TONE_CLASS.info)}>
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {approverCount === 0
              ? "Nobody can approve changes right now."
              : "Only one administrator can approve changes, and nobody can approve their own request."}{" "}
            Give another administrator, or a custom role, the &quot;Approve package changes&quot; permission in Team → Roles &amp; Permissions.
          </span>
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex justify-end">
          <Button disabled={!dirty || isPending} onClick={save}>
            {isPending ? "Saving…" : "Save policy"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only an administrator can change this policy.</p>
      )}
    </Card>
  );
}
