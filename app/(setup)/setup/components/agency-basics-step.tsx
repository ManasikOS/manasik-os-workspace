"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS, LANGUAGE_OPTIONS, TIMEZONE_OPTIONS } from "@/lib/data/settings-copy";
import { pickLocaleDefaults, type LocaleDefaultRow } from "@/lib/setup/locale-detection";
import { agencyBasicsSchema } from "@/lib/validations/setup";

import { confirmAgencyBasicsAction } from "../actions";

type Option = { value: string; label: string };

/** Keeps the agency's current value selectable even when it is not in the standard list. */
function withCurrentValue(options: Option[], current: string): Option[] {
  return current && !options.some((option) => option.value === current) ? [{ value: current, label: current }, ...options] : options;
}

interface AgencyBasicsStepProps {
  initial: { agencyName: string; country: string; currency: string; timezone: string; language: string };
  confirmed: boolean;
  localeRows: LocaleDefaultRow[];
  hasLogo: boolean;
}

/**
 * Step 2. Arrives pre-filled from the browser's timezone (until the owner has
 * confirmed once), then saves through the Organisation settings action so the
 * values show up in Settings → Organisation.
 */
export function AgencyBasicsStep({ initial, confirmed, localeRows, hasLogo }: AgencyBasicsStepProps) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isSaving, startSaving] = useTransition();

  // The browser's timezone is only known on the client, so the pre-fill happens after mount.
  useEffect(() => {
    if (confirmed) return;
    const detected = pickLocaleDefaults(localeRows, Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (!detected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time browser-only pre-fill
    setForm((previous) => ({
      ...previous,
      country: detected.countryCode,
      currency: detected.currency,
      timezone: detected.timezone,
    }));
  }, [confirmed, localeRows]);

  const setField = (key: keyof typeof form) => (value: string | null) => setForm((previous) => ({ ...previous, [key]: value ?? "" }));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    const parsed = agencyBasicsSchema.safeParse({
      agencyName: form.agencyName,
      defaultCountry: form.country,
      defaultCurrency: form.currency,
      timezone: form.timezone,
      defaultLanguage: form.language,
    });
    if (!parsed.success) {
      setMessage({ ok: false, text: parsed.error.issues[0]?.message ?? "Check your details." });
      return;
    }

    startSaving(async () => {
      const result = await confirmAgencyBasicsAction(parsed.data);
      setMessage({ ok: result.ok, text: result.ok ? (result.message ?? "Saved.") : result.error });
      if (result.ok) router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>Agency name</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          value={form.agencyName}
          onChange={(event) => setForm((previous) => ({ ...previous, agencyName: event.target.value }))}
          required
        />
      </InputGroup>

      <SetupSelectField label="Country" value={form.country} options={withCurrentValue(COUNTRY_OPTIONS, form.country)} onChange={setField("country")} />
      <SetupSelectField label="Currency" value={form.currency} options={withCurrentValue(CURRENCY_OPTIONS, form.currency)} onChange={setField("currency")} />
      <SetupSelectField label="Timezone" value={form.timezone} options={withCurrentValue(TIMEZONE_OPTIONS, form.timezone)} onChange={setField("timezone")} />
      <SetupSelectField label="Main language" value={form.language} options={LANGUAGE_OPTIONS} onChange={setField("language")} />

      <p className="text-xs text-muted-foreground">
        {hasLogo ? "Your logo is set. " : "Want your logo on documents? "}
        <Link href="/management/settings/branding" className="underline underline-offset-2">
          {hasLogo ? "Change it in branding settings" : "Add it in branding settings"}
        </Link>
        .
      </p>

      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={isSaving}>
        {isSaving && <Loader2Icon className="animate-spin" />} {confirmed ? "Save changes" : "Confirm details"}
      </Button>
    </form>
  );
}

function SetupSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
