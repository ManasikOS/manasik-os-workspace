import { ToneBadge } from "@/components/ui/tone-badge";
import {
  CRITICAL_FLAG_LABELS,
  type ReadinessBand,
} from "@/lib/data/settings-copy";
import type { CriticalFlags } from "@/lib/types/settings";

import { Field } from "../components/field";
import { SettingToggleRow } from "../components/setting-toggle-row";
import SectionHeading from "@/components/section-heading";
import { InputGroupInput } from "@/components/ui/input-group";

const READINESS_TONE: Record<ReadinessBand, "success" | "warning" | "danger"> =
  {
    READY: "success",
    AT_RISK: "warning",
    BLOCKED: "danger",
  };

export function ReadinessThresholdsCard({
  readyThreshold,
  atRiskThreshold,
  onReadyChange,
  onAtRiskChange,
  criticalFlags,
  onCriticalFlagChange,
  canEdit,
  fieldErrors,
}: {
  readyThreshold: number;
  atRiskThreshold: number;
  onReadyChange: (value: number) => void;
  onAtRiskChange: (value: number) => void;
  criticalFlags: CriticalFlags;
  onCriticalFlagChange: (key: keyof CriticalFlags, next: boolean) => void;
  canEdit: boolean;
  fieldErrors: Record<string, string>;
}) {
  return (
    <div>
      <SectionHeading title="Group readiness status" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <Field
          label="Ready threshold"
          error={fieldErrors.readinessReadyThreshold}
        >
          <div className="flex items-center gap-2">
            <InputGroupInput
              type="number"
              min={0}
              max={100}
              value={readyThreshold}
              onChange={(e) => onReadyChange(Number(e.target.value))}
              disabled={!canEdit}
            />
            <ToneBadge tone={READINESS_TONE.READY} label="Ready" />
          </div>
        </Field>
        <Field
          label="At Risk threshold"
          error={fieldErrors.readinessAtRiskThreshold}
        >
          <div className="flex items-center gap-2">
            <InputGroupInput
              type="number"
              min={0}
              max={100}
              value={atRiskThreshold}
              onChange={(e) => onAtRiskChange(Number(e.target.value))}
              disabled={!canEdit}
            />
            <ToneBadge tone={READINESS_TONE.AT_RISK} label="At Risk" />
          </div>
        </Field>
        <Field
          label="Blocked threshold"
          hint="Derived — anything below At Risk."
        >
          <div className="flex items-center gap-2">
            <InputGroupInput value={`Below ${atRiskThreshold}%`} readOnly disabled />
            <ToneBadge tone={READINESS_TONE.BLOCKED} label="Blocked" />
          </div>
        </Field>
      </div>

      <div className="flex flex-col divide-y divide-border/20 mt-3">
        {(Object.keys(CRITICAL_FLAG_LABELS) as (keyof CriticalFlags)[]).map(
          (key) => (
            <SettingToggleRow
              key={key}
              label={CRITICAL_FLAG_LABELS[key]}
              checked={criticalFlags[key]}
              onCheckedChange={(next) => onCriticalFlagChange(key, next)}
              disabled={!canEdit}
            />
          ),
        )}
      </div>
    </div>
  );
}
