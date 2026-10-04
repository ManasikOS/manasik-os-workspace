import { Users2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import InputFormCard from "@/components/ui/input-form-card";
import {
  GROUP_STATUS_OPTIONS,
  SALES_STATUS_OPTIONS,
} from "@/lib/data/settings-copy";

import { Field } from "../components/field";
import { SelectDropdown } from "../components/select-dropdown";
import { SettingToggleRow } from "../components/setting-toggle-row";
import SectionHeading from "@/components/section-heading";
import { InputGroupInput } from "@/components/ui/input-group";

export interface GroupDefaultsValue {
  defaultGroupCapacity: number;
  minimumGroupSize: number;
  defaultSeatHoldHours: number;
  defaultGuideRatio: number;
  defaultGroupStatus: string;
  defaultSalesStatus: string;
  waitlistsEnabledByDefault: boolean;
}

export function GroupDefaultsCard({
  value,
  onChange,
  canEdit,
  fieldErrors,
}: {
  value: GroupDefaultsValue;
  onChange: <K extends keyof GroupDefaultsValue>(
    key: K,
    next: GroupDefaultsValue[K],
  ) => void;
  canEdit: boolean;
  fieldErrors: Record<string, string>;
}) {
  return (
    <div>
      <SectionHeading title="Departure group defaults" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <Field
          label="Default Group Capacity"
          error={fieldErrors.defaultGroupCapacity}
        >
          <InputGroupInput
            type="number"
            min={1}
            value={value.defaultGroupCapacity}
            onChange={(e) =>
              onChange("defaultGroupCapacity", Number(e.target.value))
            }
            disabled={!canEdit}
          />
        </Field>
        <Field label="Minimum Group Size" error={fieldErrors.minimumGroupSize}>
          <InputGroupInput
            type="number"
            min={1}
            value={value.minimumGroupSize}
            onChange={(e) =>
              onChange("minimumGroupSize", Number(e.target.value))
            }
            disabled={!canEdit}
          />
        </Field>
        <Field label="Default Seat Hold Duration (hours)">
          <InputGroupInput
            type="number"
            min={1}
            value={value.defaultSeatHoldHours}
            onChange={(e) =>
              onChange("defaultSeatHoldHours", Number(e.target.value))
            }
            disabled={!canEdit}
          />
        </Field>
        <Field label="Default Guide Ratio (pilgrims per guide)">
          <InputGroupInput
            type="number"
            min={1}
            value={value.defaultGuideRatio}
            onChange={(e) =>
              onChange("defaultGuideRatio", Number(e.target.value))
            }
            disabled={!canEdit}
          />
        </Field>
        <SelectDropdown
          value={value.defaultGroupStatus}
          onChange={(v) => onChange("defaultGroupStatus", v)}
          options={GROUP_STATUS_OPTIONS}
          disabled={!canEdit}
          label="Default Group Status"
        />
        <SelectDropdown
          value={value.defaultSalesStatus}
          onChange={(v) => onChange("defaultSalesStatus", v)}
          options={SALES_STATUS_OPTIONS}
          disabled={!canEdit}
          label="Default Sales Status"
        />
      </div>
      <div className="mt-2">
        <SettingToggleRow
          label="Enable waitlists by default"
          checked={value.waitlistsEnabledByDefault}
          onCheckedChange={(next) =>
            onChange("waitlistsEnabledByDefault", next)
          }
          disabled={!canEdit}
        />
      </div>
    </div>
  );
}
