"use client";

import { Building2, Globe, Loader2, Mail } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import InputFormCard from "@/components/ui/input-form-card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  LANGUAGE_OPTIONS,
  TIMEZONE_OPTIONS,
} from "@/lib/data/settings-copy";
import type { AgencySettingsRow } from "@/lib/types/settings";

import { updateOrganisationSettingsAction } from "../actions";
import { Field } from "../components/field";
import { SectionShell } from "../components/section-shell";
import { SelectDropdown } from "../components/select-dropdown";
import SectionHeading from "@/components/section-heading";
import {
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";

export function OrganisationForm({
  settings,
  canEdit,
}: {
  settings: AgencySettingsRow;
  canEdit: boolean;
}) {
  const [agencyName, setAgencyName] = useState(settings.agency_name);
  const [legalName, setLegalName] = useState(settings.legal_name ?? "");
  const [registrationNumber, setRegistrationNumber] = useState(
    settings.registration_number ?? "",
  );
  const [defaultCountry, setDefaultCountry] = useState(
    settings.default_country,
  );
  const [defaultCurrency, setDefaultCurrency] = useState(
    settings.default_currency,
  );
  const [timezone, setTimezone] = useState(settings.timezone);
  const [defaultLanguage, setDefaultLanguage] = useState(
    settings.default_language,
  );
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>(
    settings.supported_languages,
  );
  const [primaryEmail, setPrimaryEmail] = useState(
    settings.primary_email ?? "",
  );
  const [primaryWhatsapp, setPrimaryWhatsapp] = useState(
    settings.primary_whatsapp ?? "",
  );
  const [officeAddress, setOfficeAddress] = useState(
    settings.office_address ?? "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const toggleLanguage = (value: string) => {
    setSupportedLanguages((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  const save = async () => {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const result = await updateOrganisationSettingsAction({
      agencyName,
      legalName,
      registrationNumber,
      defaultCountry,
      defaultCurrency,
      timezone,
      defaultLanguage,
      supportedLanguages,
      primaryEmail,
      primaryWhatsapp,
      officeAddress,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save Organisation settings.");
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    toast.add({ title: "Organisation settings saved" });
  };

  return (
    <SectionShell
      title="Organisation"
      description="The agency identity used across invoices, receipts, WhatsApp templates, the pilgrim portal and PDF reports."
      footer={
        canEdit && (
          <>
            {error && (
              <p className="text-xs text-destructive mr-auto">{error}</p>
            )}
            <Button onClick={save} disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />} Save Changes
            </Button>
          </>
        )
      }
    >
      <div>
        <SectionHeading title="Identity" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Field label="Agency Name *" error={fieldErrors.agencyName}>
            <InputGroupInput
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              placeholder="Royal Fathima Travels"
              disabled={!canEdit}
            />
          </Field>
          <Field label="Legal / Registered Name">
            <InputGroupInput
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Royal Fathima Travels (Pvt) Ltd"
              disabled={!canEdit}
            />
          </Field>
          <Field label="Agency Registration Number">
            <InputGroupInput
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
        </div>
      </div>

      <div>
        <SectionHeading title="Locale" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <SelectDropdown
            value={defaultCountry}
            label="Default Country"
            onChange={setDefaultCountry}
            options={COUNTRY_OPTIONS}
            disabled={!canEdit}
          />
          <SelectDropdown
            value={defaultCurrency}
            onChange={setDefaultCurrency}
            label="Default Currency"
            options={CURRENCY_OPTIONS}
            disabled={!canEdit}
          />
          <SelectDropdown
            value={timezone}
            label="Timezone"
            onChange={setTimezone}
            options={TIMEZONE_OPTIONS}
            disabled={!canEdit}
          />
          <SelectDropdown
            value={defaultLanguage}
            label="Default Language"
            onChange={setDefaultLanguage}
            options={LANGUAGE_OPTIONS}
            disabled={!canEdit}
          />
        </div>
        <div className="mt-3">
          <span className="text-xs font-medium text-muted-foreground">
            Supported Staff Languages
          </span>
          <div className="flex flex-wrap gap-4 mt-2">
            {LANGUAGE_OPTIONS.map((lang) => (
              <label
                key={lang.value}
                className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
              >
                <Checkbox
                  checked={supportedLanguages.includes(lang.value)}
                  onCheckedChange={() => toggleLanguage(lang.value)}
                  disabled={!canEdit}
                />
                {lang.label}
              </label>
            ))}
          </div>
          {fieldErrors.supportedLanguages && (
            <p className="text-xs text-destructive mt-1">
              {fieldErrors.supportedLanguages}
            </p>
          )}
        </div>
      </div>

      <div>
        <SectionHeading title="Contact" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Field label="Primary Agency Email" error={fieldErrors.primaryEmail}>
            <InputGroupInput
              type="email"
              value={primaryEmail}
              onChange={(e) => setPrimaryEmail(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Primary WhatsApp Number">
            <InputGroupInput
              value={primaryWhatsapp}
              onChange={(e) => setPrimaryWhatsapp(e.target.value)}
              placeholder="+94 77 123 4567"
              disabled={!canEdit}
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Office Address">
            <InputGroupTextarea
              value={officeAddress}
              onChange={(e) => setOfficeAddress(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
        </div>
      </div>
    </SectionShell>
  );
}
