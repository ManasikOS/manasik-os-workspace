import { ShieldCheck } from "lucide-react";

import { InputGroupInput } from "@/components/ui/input-group";
import InputFormCard from "@/components/ui/input-form-card";
import { ACCOUNT_SECURITY_UNAVAILABLE_REASON } from "@/lib/data/settings-copy";

import { Field } from "../components/field";
import { SettingToggleRow } from "../components/setting-toggle-row";
import { UnavailableNote } from "../components/unavailable-note";

/**
 * Every toggle here except session idle timeout is read-only — see F6 / D15.
 * Password policy, reset cadence, 2FA and unusual-login alerts are Supabase
 * Auth project settings, not something this application can enforce.
 */
export function AccountSecurityCard({
  sessionIdleTimeoutMinutes,
  onIdleTimeoutChange,
  canEdit,
}: {
  sessionIdleTimeoutMinutes: number;
  onIdleTimeoutChange?: (value: number) => void;
  canEdit: boolean;
}) {
  return (
    <InputFormCard title="Account security" icon={<ShieldCheck className="size-4" />}>
      <div className="flex flex-col divide-y divide-border/20 mt-2">
        <div>
          <SettingToggleRow label="Require strong passwords" checked disabled />
          <UnavailableNote reason={ACCOUNT_SECURITY_UNAVAILABLE_REASON} />
        </div>
        <div className="pt-2">
          <SettingToggleRow label="Require password reset every X days" checked={false} disabled />
          <UnavailableNote reason={ACCOUNT_SECURITY_UNAVAILABLE_REASON} />
        </div>
        <div className="pt-2">
          <SettingToggleRow label="Enable two-factor authentication" checked={false} disabled />
          <UnavailableNote reason={ACCOUNT_SECURITY_UNAVAILABLE_REASON} />
        </div>
        <div className="pt-2">
          <SettingToggleRow label="Require 2FA for Admin and Finance" checked={false} disabled />
          <UnavailableNote reason={ACCOUNT_SECURITY_UNAVAILABLE_REASON} />
        </div>
        <div className="pt-2">
          <SettingToggleRow label="Notify Admin on unusual login" checked={false} disabled />
          <UnavailableNote reason="No login-alert delivery mechanism exists in the application yet." />
        </div>
      </div>

      <div className="mt-3 max-w-xs">
        <Field label="Auto-log out inactive sessions after (minutes)">
          <InputGroupInput
            type="number"
            min={5}
            value={sessionIdleTimeoutMinutes}
            onChange={(e) => onIdleTimeoutChange?.(Number(e.target.value))}
            disabled={!canEdit}
          />
        </Field>
      </div>
    </InputFormCard>
  );
}
