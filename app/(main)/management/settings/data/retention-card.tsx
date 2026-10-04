"use client";

import { Archive, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import InputFormCard from "@/components/ui/input-form-card";
import { toast } from "@/components/ui/toast";
import { RETENTION_PERIOD_OPTIONS } from "@/lib/data/settings-copy";
import type { AgencySettingsRow } from "@/lib/types/settings";

import { updateRetentionSettingsAction } from "../actions";
import { Field } from "../components/field";
import { SelectDropdown } from "../components/select-dropdown";
import { SettingToggleRow } from "../components/setting-toggle-row";

const PERIOD_OPTIONS = RETENTION_PERIOD_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }));

export function RetentionCard({ settings, canEdit }: { settings: AgencySettingsRow; canEdit: boolean }) {
  const [documentRetentionYears, setDocumentRetentionYears] = useState(settings.document_retention_years);
  const [archivedGroupRetentionYears, setArchivedGroupRetentionYears] = useState(settings.archived_group_retention_years);
  const [deactivatedUserRetentionYears, setDeactivatedUserRetentionYears] = useState(settings.deactivated_user_retention_years);
  const [immutableFinanceHistory, setImmutableFinanceHistory] = useState(settings.immutable_finance_history);
  const [keepDocumentVerificationHistory, setKeepDocumentVerificationHistory] = useState(
    settings.keep_document_verification_history,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSubmitting(true);
    setError(null);

    const result = await updateRetentionSettingsAction({
      documentRetentionYears,
      archivedGroupRetentionYears,
      deactivatedUserRetentionYears,
      immutableFinanceHistory,
      keepDocumentVerificationHistory,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save retention settings.");
      return;
    }
    toast.add({ title: "Data retention settings saved" });
  };

  return (
    <InputFormCard title="Data retention" icon={<Archive className="size-4" />}>
      <p className="text-xs text-muted-foreground mt-1">
        These periods govern core business records. Inbox messages, media and AI audit data use the separate nightly policy below.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <Field label="Document retention period">
          <SelectDropdown
            value={String(documentRetentionYears)}
            onChange={(v) => setDocumentRetentionYears(Number(v))}
            options={PERIOD_OPTIONS}
            disabled={!canEdit}
          />
        </Field>
        <Field label="Archived group retention">
          <SelectDropdown
            value={String(archivedGroupRetentionYears)}
            onChange={(v) => setArchivedGroupRetentionYears(Number(v))}
            options={PERIOD_OPTIONS}
            disabled={!canEdit}
          />
        </Field>
        <Field label="Deactivated user retention">
          <SelectDropdown
            value={String(deactivatedUserRetentionYears)}
            onChange={(v) => setDeactivatedUserRetentionYears(Number(v))}
            options={PERIOD_OPTIONS}
            disabled={!canEdit}
          />
        </Field>
      </div>

      <div className="flex flex-col divide-y divide-border/20 mt-3">
        <SettingToggleRow
          label="Keep immutable finance audit history"
          checked={immutableFinanceHistory}
          onCheckedChange={setImmutableFinanceHistory}
          disabled={!canEdit}
        />
        <SettingToggleRow
          label="Keep document verification history"
          checked={keepDocumentVerificationHistory}
          onCheckedChange={setKeepDocumentVerificationHistory}
          disabled={!canEdit}
        />
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-3 mt-3">
          {error && <p className="text-xs text-destructive mr-auto">{error}</p>}
          <Button size="sm" onClick={save} disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />} Save Changes
          </Button>
        </div>
      )}
    </InputFormCard>
  );
}
