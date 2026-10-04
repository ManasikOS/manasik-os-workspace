"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { BranchRules } from "@/lib/types/settings";

import { updateBranchRulesAction } from "../actions";
import { SectionShell } from "../components/section-shell";
import { SettingToggleRow } from "../components/setting-toggle-row";
import { UnavailableNote } from "../components/unavailable-note";

export function BranchRulesCard({ rules, canEdit }: { rules: BranchRules; canEdit: boolean }) {
  const [value, setValue] = useState(rules);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof BranchRules>(key: K, next: boolean) =>
    setValue((prev) => ({ ...prev, [key]: next }));

  const save = async () => {
    setSubmitting(true);
    setError(null);

    const result = await updateBranchRulesAction(value);

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save branch rules.");
      return;
    }
    toast.add({ title: "Branch rules saved" });
  };

  return (
    <SectionShell
      title="Branch rules"
      footer={
        canEdit && (
          <>
            {error && <p className="text-xs text-destructive mr-auto">{error}</p>}
            <Button onClick={save} disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />} Save Changes
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col divide-y divide-border/20">
        <SettingToggleRow
          label="Restrict staff to their assigned branch"
          checked={value.restrictStaffToAssignedBranch}
          onCheckedChange={(c) => set("restrictStaffToAssignedBranch", c)}
          disabled={!canEdit}
        />
        <SettingToggleRow
          label="Allow Admin to view all branches"
          checked={value.allowAdminViewAllBranches}
          onCheckedChange={(c) => set("allowAdminViewAllBranches", c)}
          disabled={!canEdit}
        />
        <SettingToggleRow
          label="Allow CEO to view all branches"
          checked={value.allowCeoViewAllBranches}
          onCheckedChange={(c) => set("allowCeoViewAllBranches", c)}
          disabled={!canEdit}
        />
        <div>
          <SettingToggleRow
            label="Allow cross-branch booking management"
            checked={value.allowCrossBranchBookingManagement}
            disabled
          />
          <UnavailableNote reason="No booking, lead or pilgrim record is branch-scoped yet, so there is nothing for this switch to enforce. It unlocks once branch scoping ships." />
        </div>
      </div>
    </SectionShell>
  );
}
