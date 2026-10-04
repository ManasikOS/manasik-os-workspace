"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { PermissionDenied } from "@/components/ui/tone-badge";
import React, { useState } from "react";

import type { PilgrimCapabilities } from "@/lib/access/pilgrims-access";
import type { PilgrimRow } from "@/lib/types/pilgrims";
import { updatePersonalDetailsAction, updatePilgrimConsentAction } from "../../../actions";
import ConsentCard from "@/components/consent-card";
import SectionHeading from "@/components/section-heading";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

function Field({
  label,
  value,
  onChange,
  disabled,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <InputGroup>
        <InputGroupAddon align={"block-start"}>
          <InputGroupText>{label}</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      </InputGroup>
    </div>
  );
}

export default function PersonalTab({
  person,
  can,
}: {
  person: PilgrimRow;
  can: PilgrimCapabilities;
}) {
  const [form, setForm] = useState({
    fullName: person.full_name,
    preferredName: person.preferred_name ?? "",
    dateOfBirth: person.date_of_birth ?? "",
    nationality: person.nationality,
    nationalId: person.national_id ?? "",
    countryOfResidence: person.country_of_residence,
    city: person.city,
    preferredLanguage: person.preferred_language,
    whatsappNumber: person.whatsapp_number,
    mobileNumber: person.mobile_number ?? "",
    email: person.email ?? "",
    passportNumber: person.passport_number ?? "",
    passportExpiry: person.passport_expiry ?? "",
    emergencyContactName: person.emergency_contact_name ?? "",
    emergencyContactRelationship: person.emergency_contact_relationship ?? "",
    emergencyContactPhone: person.emergency_contact_phone ?? "",
    emergencyContactAltPhone: person.emergency_contact_alt_phone ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setSaving(true);
    const result = await updatePersonalDetailsAction({
      pilgrimId: person.id,
      ...form,
    });
    setSaving(false);
    if (!result.ok) {
      toast.add({ title: "Could not save", description: result.error });
      return;
    }
    toast.add({ title: "Personal details updated" });
  };

  if (!can.editPersonalDetails) {
    return (
      <div className="flex flex-col gap-4">
        <Card className="gap-3">
          <SectionHeading title="Core Details" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">
                Full name
              </span>
              {person.full_name}
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">City</span>
              {person.city || "—"}
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">
                WhatsApp
              </span>
              {person.whatsapp_number}
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Email</span>
              {person.email ?? "—"}
            </div>
          </div>
        </Card>
        <ConsentCard
          consentStatus={person.consent_status}
          consentSource={person.consent_source}
          consentAt={person.consent_at}
          doNotContact={person.do_not_contact}
          contactableChannels={person.contactable_channels}
          canManage={false}
        />
        <PermissionDenied what="Editing personal details" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-4">
        <SectionHeading title="Core Details" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Full name *"
            value={form.fullName}
            onChange={set("fullName")}
          />
          <Field
            label="Preferred name"
            value={form.preferredName}
            onChange={set("preferredName")}
          />
          <Field
            label="Date of birth"
            type="date"
            value={form.dateOfBirth}
            onChange={set("dateOfBirth")}
          />
          <Field
            label="Nationality"
            value={form.nationality}
            onChange={set("nationality")}
          />
          <Field
            label="National ID / NIC"
            value={form.nationalId}
            onChange={set("nationalId")}
          />
          <Field
            label="Country of residence"
            value={form.countryOfResidence}
            onChange={set("countryOfResidence")}
          />
          <Field label="City" value={form.city} onChange={set("city")} />
          <Field
            label="Preferred language"
            value={form.preferredLanguage}
            onChange={set("preferredLanguage")}
          />
        </div>
      </Card>

      <Card className="gap-4">
        <SectionHeading title="Contact Details" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="WhatsApp number *"
            value={form.whatsappNumber}
            onChange={set("whatsappNumber")}
          />
          <Field
            label="Mobile number"
            value={form.mobileNumber}
            onChange={set("mobileNumber")}
          />
          <Field label="Email" value={form.email} onChange={set("email")} />
        </div>
      </Card>

      {can.viewPassportAndIdentity && (
        <Card className="gap-4">
          <SectionHeading title="Passport" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Passport number"
              value={form.passportNumber}
              onChange={set("passportNumber")}
            />
            <Field
              label="Passport expiry"
              type="date"
              value={form.passportExpiry}
              onChange={set("passportExpiry")}
            />
          </div>
        </Card>
      )}

      {can.viewEmergencyContact && (
        <Card className="gap-4">
          <SectionHeading title="Emergency Contact" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Emergency contact name *"
              value={form.emergencyContactName}
              onChange={set("emergencyContactName")}
            />
            <Field
              label="Relationship *"
              value={form.emergencyContactRelationship}
              onChange={set("emergencyContactRelationship")}
            />
            <Field
              label="WhatsApp / phone *"
              value={form.emergencyContactPhone}
              onChange={set("emergencyContactPhone")}
            />
            <Field
              label="Alternate number"
              value={form.emergencyContactAltPhone}
              onChange={set("emergencyContactAltPhone")}
            />
          </div>
        </Card>
      )}

      <ConsentCard
        consentStatus={person.consent_status}
        consentSource={person.consent_source}
        consentAt={person.consent_at}
        doNotContact={person.do_not_contact}
        contactableChannels={person.contactable_channels}
        canManage
        onSave={(input) => updatePilgrimConsentAction({ pilgrimId: person.id, ...input })}
      />

      <div className="flex justify-end">
        <Button
          onClick={save}
          disabled={
            saving || !form.fullName.trim() || !form.whatsappNumber.trim()
          }
        >
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Sensitive information — passport, medical notes, identity documents,
        payment data — is visible only to Admin, Visa, Operations and Finance
        where relevant.
      </p>
    </div>
  );
}
