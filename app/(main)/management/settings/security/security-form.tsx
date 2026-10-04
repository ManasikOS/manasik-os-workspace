"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { AgencySettingsRow } from "@/lib/types/settings";

import { updateSecurityDefaultsAction } from "../actions";
import { SectionShell } from "../components/section-shell";
import { AccessDefaultsCard, type AccessDefaultsValue } from "./access-defaults-card";
import { AccountSecurityCard } from "./account-security-card";

export function SecurityForm({ settings, canEdit }: { settings: AgencySettingsRow; canEdit: boolean }) {
  const [sessionIdleTimeoutMinutes, setSessionIdleTimeoutMinutes] = useState(settings.session_idle_timeout_minutes);
  const [accessDefaults, setAccessDefaults] = useState<AccessDefaultsValue>({
    defaultStaffRole: settings.default_staff_role,
    requireAccountApproval: settings.require_account_approval,
    seasonalAutoExpiryEnabled: settings.seasonal_auto_expiry_enabled,
    seasonalExpiryDays: settings.seasonal_expiry_days,
    accessRestrictionFlags: settings.access_restriction_flags,
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAccessField = <K extends keyof AccessDefaultsValue>(key: K, next: AccessDefaultsValue[K]) =>
    setAccessDefaults((prev) => ({ ...prev, [key]: next }));

  const save = async () => {
    setSubmitting(true);
    setError(null);

    const result = await updateSecurityDefaultsAction({
      ...accessDefaults,
      sessionIdleTimeoutMinutes,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save Security & Access defaults.");
      return;
    }

    toast.add({ title: "Security & Access defaults saved" });
  };

  return (
    <SectionShell
      title="Security & Access"
      description="Admin-only. Password policy and 2FA are configured in the Supabase Auth project — everything below is what this application can actually enforce."
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
      <AccountSecurityCard
        sessionIdleTimeoutMinutes={sessionIdleTimeoutMinutes}
        onIdleTimeoutChange={setSessionIdleTimeoutMinutes}
        canEdit={canEdit}
      />
      <AccessDefaultsCard value={accessDefaults} onChange={setAccessField} canEdit={canEdit} />
    </SectionShell>
  );
}
