"use client";

import { Loader2, Palette } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import InputFormCard from "@/components/ui/input-form-card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { AgencySettingsRow, PortalFlags } from "@/lib/types/settings";

import { updateBrandingSettingsAction } from "../actions";
import { Field } from "../components/field";
import { SectionShell } from "../components/section-shell";
import { LogoUpload } from "./logo-upload";
import { PortalFlagsCard } from "./portal-flags-card";
import SectionHeading from "@/components/section-heading";
import {
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";

export function BrandingForm({
  settings,
  logoUrl,
  canEdit,
}: {
  settings: AgencySettingsRow;
  logoUrl: string | null;
  canEdit: boolean;
}) {
  const [logoPath, setLogoPath] = useState(settings.logo_path ?? "");
  const [currentLogoUrl, setCurrentLogoUrl] = useState(logoUrl);
  const [primaryColour, setPrimaryColour] = useState(
    settings.portal_primary_colour,
  );
  const [secondaryColour, setSecondaryColour] = useState(
    settings.portal_secondary_colour ?? "",
  );
  const [welcomeMessage, setWelcomeMessage] = useState(
    settings.portal_welcome_message ?? "",
  );
  const [supportWhatsapp, setSupportWhatsapp] = useState(
    settings.portal_support_whatsapp ?? "",
  );
  const [supportEmail, setSupportEmail] = useState(
    settings.portal_support_email ?? "",
  );
  const [websiteUrl, setWebsiteUrl] = useState(settings.website_url ?? "");
  const [termsUrl, setTermsUrl] = useState(settings.terms_url ?? "");
  const [invoiceFooter, setInvoiceFooter] = useState(settings.invoice_footer);
  const [portalFlags, setPortalFlags] = useState<PortalFlags>(
    settings.portal_flags,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const setPortalFlag = (key: keyof PortalFlags, next: boolean) =>
    setPortalFlags((prev) => ({ ...prev, [key]: next }));

  const save = async () => {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const result = await updateBrandingSettingsAction({
      logoPath,
      portalPrimaryColour: primaryColour,
      portalSecondaryColour: secondaryColour,
      portalWelcomeMessage: welcomeMessage,
      portalSupportWhatsapp: supportWhatsapp,
      portalSupportEmail: supportEmail,
      websiteUrl,
      termsUrl,
      invoiceFooter,
      portalFlags,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save Branding settings.");
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    toast.add({ title: "Branding settings saved" });
  };

  return (
    <SectionShell
      title="Branding & Pilgrim Portal"
      description="How the agency appears to customers — on invoices, receipts and (once it ships) the pilgrim portal."
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
        <div className="mt-3">
          <span className="text-xs font-medium text-muted-foreground">
            Agency Logo
          </span>
          <div className="mt-1.5">
            <LogoUpload
              logoUrl={currentLogoUrl}
              canEdit={canEdit}
              onUploaded={(path, url) => {
                setLogoPath(path);
                setCurrentLogoUrl(url);
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <Field
            label="Portal Primary Colour"
            error={fieldErrors.portalPrimaryColour}
          >
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColour}
                onChange={(e) => setPrimaryColour(e.target.value)}
                disabled={!canEdit}
                className="size-8 rounded border border-input bg-transparent cursor-pointer disabled:cursor-not-allowed"
              />
              <InputGroupInput
                value={primaryColour}
                onChange={(e) => setPrimaryColour(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </Field>
          <Field
            label="Secondary Colour"
            error={fieldErrors.portalSecondaryColour}
          >
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={secondaryColour || "#000000"}
                onChange={(e) => setSecondaryColour(e.target.value)}
                disabled={!canEdit}
                className="size-8 rounded border border-input bg-transparent cursor-pointer disabled:cursor-not-allowed"
              />
              <InputGroupInput
                value={secondaryColour}
                onChange={(e) => setSecondaryColour(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Portal Welcome Message">
            <InputGroupTextarea
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              placeholder="Assalamu Alaikum. Welcome to Royal Fathima Travels."
              disabled={!canEdit}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Field label="Portal Support WhatsApp">
            <InputGroupInput
              value={supportWhatsapp}
              onChange={(e) => setSupportWhatsapp(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="Portal Support Email"
            error={fieldErrors.portalSupportEmail}
          >
            <InputGroupInput
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Website URL" error={fieldErrors.websiteUrl}>
            <InputGroupInput
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Terms URL" error={fieldErrors.termsUrl}>
            <InputGroupInput
              value={termsUrl}
              onChange={(e) => setTermsUrl(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Invoice Footer">
            <InputGroupTextarea
              value={invoiceFooter}
              onChange={(e) => setInvoiceFooter(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
        </div>
      </div>

      <PortalFlagsCard
        flags={portalFlags}
        onChange={setPortalFlag}
        canEdit={canEdit}
      />
    </SectionShell>
  );
}
