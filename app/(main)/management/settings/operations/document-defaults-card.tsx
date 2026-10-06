import { FileCheck2 } from "lucide-react";

import { InputGroupInput } from "@/components/ui/input-group";
import InputFormCard from "@/components/ui/input-form-card";
import { PASSPORT_PHOTO_REQUIREMENT_OPTIONS } from "@/lib/data/settings-copy";

import { Field } from "../components/field";
import { SelectDropdown } from "../components/select-dropdown";
import { SettingToggleRow } from "../components/setting-toggle-row";

export interface DocumentDefaultsValue {
  passportValidityMonths: number;
  passportPhotoRequirement: string;
  documentReminderDays: number;
  documentReworkDeadlineHours: number;
  visaEscalationDays: number;
  requireDocumentVerification: boolean;
  requireVisaVerification: boolean;
}

export function DocumentDefaultsCard({
  value,
  onChange,
  canEdit,
}: {
  value: DocumentDefaultsValue;
  onChange: <K extends keyof DocumentDefaultsValue>(key: K, next: DocumentDefaultsValue[K]) => void;
  canEdit: boolean;
}) {
  return (
    <InputFormCard title="Document and visa defaults" icon={<FileCheck2 className="size-4" />}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <Field label="Passport validity threshold (months)">
          <InputGroupInput
            type="number"
            min={1}
            value={value.passportValidityMonths}
            onChange={(e) => onChange("passportValidityMonths", Number(e.target.value))}
            disabled={!canEdit}
          />
        </Field>
        <Field label="Default passport photo requirement">
          <SelectDropdown
            value={value.passportPhotoRequirement}
            onChange={(v) => onChange("passportPhotoRequirement", v)}
            options={PASSPORT_PHOTO_REQUIREMENT_OPTIONS}
            disabled={!canEdit}
          />
        </Field>
        <Field label="Default reminder frequency (days)">
          <InputGroupInput
            type="number"
            min={1}
            value={value.documentReminderDays}
            onChange={(e) => onChange("documentReminderDays", Number(e.target.value))}
            disabled={!canEdit}
          />
        </Field>
        <Field label="Document rework deadline (hours)">
          <InputGroupInput
            type="number"
            min={1}
            value={value.documentReworkDeadlineHours}
            onChange={(e) => onChange("documentReworkDeadlineHours", Number(e.target.value))}
            disabled={!canEdit}
          />
        </Field>
        <Field label="Visa escalation window (days before departure)">
          <InputGroupInput
            type="number"
            min={1}
            value={value.visaEscalationDays}
            onChange={(e) => onChange("visaEscalationDays", Number(e.target.value))}
            disabled={!canEdit}
          />
        </Field>
      </div>

      <div className="flex flex-col divide-y divide-border/20 mt-3">
        <SettingToggleRow
          label="Require staff verification before documents count as complete"
          checked={value.requireDocumentVerification}
          onCheckedChange={(next) => onChange("requireDocumentVerification", next)}
          disabled={!canEdit}
        />
        <SettingToggleRow
          label="Require staff verification before visa counts as issued"
          checked={value.requireVisaVerification}
          onCheckedChange={(next) => onChange("requireVisaVerification", next)}
          disabled={!canEdit}
        />
      </div>
    </InputFormCard>
  );
}
