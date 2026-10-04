"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { AgencySettingsRow, CriticalFlags } from "@/lib/types/settings";

import { updateOperationalDefaultsAction } from "../actions";
import { SectionShell } from "../components/section-shell";
import { DocumentDefaultsCard, type DocumentDefaultsValue } from "./document-defaults-card";
import { GroupDefaultsCard, type GroupDefaultsValue } from "./group-defaults-card";
import { ReadinessThresholdsCard } from "./readiness-thresholds-card";

export function OperationalDefaultsForm({ settings, canEdit }: { settings: AgencySettingsRow; canEdit: boolean }) {
  const [groupDefaults, setGroupDefaults] = useState<GroupDefaultsValue>({
    defaultGroupCapacity: settings.default_group_capacity,
    minimumGroupSize: settings.minimum_group_size,
    defaultSeatHoldHours: settings.default_seat_hold_hours,
    defaultGuideRatio: settings.default_guide_ratio,
    defaultGroupStatus: settings.default_group_status,
    defaultSalesStatus: settings.default_sales_status,
    waitlistsEnabledByDefault: settings.waitlists_enabled_by_default,
  });
  const [readyThreshold, setReadyThreshold] = useState(settings.readiness_ready_threshold);
  const [atRiskThreshold, setAtRiskThreshold] = useState(settings.readiness_at_risk_threshold);
  const [criticalFlags, setCriticalFlags] = useState<CriticalFlags>(settings.critical_flags);
  const [documentDefaults, setDocumentDefaults] = useState<DocumentDefaultsValue>({
    passportValidityMonths: settings.passport_validity_months,
    passportPhotoRequirement: settings.passport_photo_requirement,
    documentReminderDays: settings.document_reminder_days,
    documentReworkDeadlineHours: settings.document_rework_deadline_hours,
    visaEscalationDays: settings.visa_escalation_days,
    requireDocumentVerification: settings.require_document_verification,
    requireVisaVerification: settings.require_visa_verification,
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const setGroupField = <K extends keyof GroupDefaultsValue>(key: K, next: GroupDefaultsValue[K]) =>
    setGroupDefaults((prev) => ({ ...prev, [key]: next }));

  const setDocumentField = <K extends keyof DocumentDefaultsValue>(key: K, next: DocumentDefaultsValue[K]) =>
    setDocumentDefaults((prev) => ({ ...prev, [key]: next }));

  const setCriticalFlag = (key: keyof CriticalFlags, next: boolean) =>
    setCriticalFlags((prev) => ({ ...prev, [key]: next }));

  const save = async () => {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const result = await updateOperationalDefaultsAction({
      ...groupDefaults,
      readinessReadyThreshold: readyThreshold,
      readinessAtRiskThreshold: atRiskThreshold,
      criticalFlags,
      ...documentDefaults,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save Operational defaults.");
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    toast.add({ title: "Operational defaults saved" });
  };

  return (
    <SectionShell
      title="Operational Defaults"
      description="The reusable rules new departure groups, readiness bands and document/visa checklists start from. Changing these never rewrites an existing group."
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
      <GroupDefaultsCard value={groupDefaults} onChange={setGroupField} canEdit={canEdit} fieldErrors={fieldErrors} />
      <ReadinessThresholdsCard
        readyThreshold={readyThreshold}
        atRiskThreshold={atRiskThreshold}
        onReadyChange={setReadyThreshold}
        onAtRiskChange={setAtRiskThreshold}
        criticalFlags={criticalFlags}
        onCriticalFlagChange={setCriticalFlag}
        canEdit={canEdit}
        fieldErrors={fieldErrors}
      />
      <DocumentDefaultsCard value={documentDefaults} onChange={setDocumentField} canEdit={canEdit} />
    </SectionShell>
  );
}
