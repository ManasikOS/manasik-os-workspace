import { UserCog } from "lucide-react";

import { InputGroupInput } from "@/components/ui/input-group";
import InputFormCard from "@/components/ui/input-form-card";
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from "@/lib/access/departure-groups-access";
import { ACCESS_RESTRICTION_FLAG_LABELS } from "@/lib/data/settings-copy";
import type { AccessRestrictionFlags } from "@/lib/types/settings";

import { Field } from "../components/field";
import { SelectDropdown } from "../components/select-dropdown";
import { SettingToggleRow } from "../components/setting-toggle-row";

const ROLE_OPTIONS = STAFF_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

export interface AccessDefaultsValue {
  defaultStaffRole: StaffRole;
  requireAccountApproval: boolean;
  seasonalAutoExpiryEnabled: boolean;
  seasonalExpiryDays: number;
  accessRestrictionFlags: AccessRestrictionFlags;
}

export function AccessDefaultsCard({
  value,
  onChange,
  canEdit,
}: {
  value: AccessDefaultsValue;
  onChange: <K extends keyof AccessDefaultsValue>(key: K, next: AccessDefaultsValue[K]) => void;
  canEdit: boolean;
}) {
  const setFlag = (key: keyof AccessRestrictionFlags, next: boolean) =>
    onChange("accessRestrictionFlags", { ...value.accessRestrictionFlags, [key]: next });

  return (
    <InputFormCard title="Access defaults" icon={<UserCog className="size-4" />}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <Field label="Default staff role">
          <SelectDropdown
            value={value.defaultStaffRole}
            onChange={(v) => onChange("defaultStaffRole", v as StaffRole)}
            options={ROLE_OPTIONS}
            disabled={!canEdit}
          />
        </Field>
        <Field label="Default seasonal account expiry (days)">
          <InputGroupInput
            type="number"
            min={1}
            value={value.seasonalExpiryDays}
            onChange={(e) => onChange("seasonalExpiryDays", Number(e.target.value))}
            disabled={!canEdit}
          />
        </Field>
      </div>

      <div className="flex flex-col divide-y divide-border/20 mt-2">
        <SettingToggleRow
          label="New account approval required"
          checked={value.requireAccountApproval}
          onCheckedChange={(next) => onChange("requireAccountApproval", next)}
          disabled={!canEdit}
        />
        <SettingToggleRow
          label="Seasonal account auto-expiry"
          checked={value.seasonalAutoExpiryEnabled}
          onCheckedChange={(next) => onChange("seasonalAutoExpiryEnabled", next)}
          disabled={!canEdit}
        />
        {(Object.keys(ACCESS_RESTRICTION_FLAG_LABELS) as (keyof AccessRestrictionFlags)[]).map((key) => (
          <SettingToggleRow
            key={key}
            label={ACCESS_RESTRICTION_FLAG_LABELS[key]}
            checked={value.accessRestrictionFlags[key]}
            onCheckedChange={(next) => setFlag(key, next)}
            disabled={!canEdit}
          />
        ))}
      </div>
    </InputFormCard>
  );
}
