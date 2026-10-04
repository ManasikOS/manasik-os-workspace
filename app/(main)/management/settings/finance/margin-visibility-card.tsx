import { EyeOff } from "lucide-react";

import InputFormCard from "@/components/ui/input-form-card";
import { STAFF_ROLES, ROLE_LABELS } from "@/lib/access/departure-groups-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { MARGIN_VISIBILITY_ELIGIBLE_ROLES } from "@/lib/data/settings-copy";

import { SettingToggleRow } from "../components/setting-toggle-row";
import { UnavailableNote } from "../components/unavailable-note";

/**
 * A role whose `capabilitiesForFinance()` / `capabilitiesForSuppliers()`
 * `viewCosts` is `false` renders unchecked and disabled here, no matter what
 * is stored — this switch can only narrow visibility from what the code
 * already grants, never widen it. See D4.
 */
export function MarginVisibilityCard({
  visibleRoles,
  onToggle,
  canEdit,
}: {
  visibleRoles: StaffRole[];
  onToggle: (role: StaffRole, next: boolean) => void;
  canEdit: boolean;
}) {
  return (
    <InputFormCard
      title="Margin visibility"
      icon={<EyeOff className="size-4" />}
      desc="Allow internal cost / margin access"
    >
      <div className="flex flex-col divide-y divide-border/20 mt-2">
        {STAFF_ROLES.map((role) => {
          const eligible = MARGIN_VISIBILITY_ELIGIBLE_ROLES.includes(role);
          return (
            <SettingToggleRow
              key={role}
              label={ROLE_LABELS[role]}
              checked={eligible && visibleRoles.includes(role)}
              onCheckedChange={eligible ? (next) => onToggle(role, next) : undefined}
              disabled={!canEdit || !eligible}
            />
          );
        })}
      </div>
      <UnavailableNote reason="Marketing, Operations, Visa and Guide can never see margin data from this switch — capability code already denies them cost fields regardless of this setting." />
    </InputFormCard>
  );
}
