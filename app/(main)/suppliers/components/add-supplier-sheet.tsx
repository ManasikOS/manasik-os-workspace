"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { ChevronDown } from "lucide-react";
import React, { useMemo, useState } from "react";

import {
  CURRENCY_LABELS,
  PAYMENT_TERMS_LABELS,
  PREFERRED_CHANNEL_LABELS,
  SERVICE_CATEGORY_LABELS,
  SUPPLIER_TYPE_LABELS,
} from "@/lib/data/suppliers-copy";
import { useSuppliers } from "../suppliers-store";
import SectionHeading from "@/components/section-heading";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card } from "@/components/ui/card";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface AddSupplierSheetProps {
  open: boolean;
  onClose: () => void;
}

const SUPPLIER_TYPES = Object.keys(SUPPLIER_TYPE_LABELS);
const SERVICE_CATEGORIES = Object.keys(SERVICE_CATEGORY_LABELS);
const CURRENCIES = Object.keys(CURRENCY_LABELS).filter((c) => c !== "OTHER");
const PAYMENT_TERMS = Object.keys(PAYMENT_TERMS_LABELS);
const CHANNELS = Object.keys(PREFERRED_CHANNEL_LABELS);

function suggestCode(name: string, city: string): string {
  const cityPart = (city || "GEN").slice(0, 3).toUpperCase();
  const namePart =
    name
      .replace(/[^a-zA-Z]/g, "")
      .slice(0, 3)
      .toUpperCase() || "SUP";
  return `SUP-${cityPart}-${namePart}`;
}

export default function AddSupplierSheet({
  open,
  onClose,
}: AddSupplierSheetProps) {
  const { suppliers, createSupplier, can } = useSuppliers();

  const [name, setName] = useState("");
  const [supplierCode, setSupplierCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [supplierType, setSupplierType] = useState("BROKER");
  const [serviceCategories, setServiceCategories] = useState<string[]>([]);
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");

  const [city, setCity] = useState("");
  const [country, setCountry] = useState("Saudi Arabia");
  const [contactName, setContactName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [preferredChannel, setPreferredChannel] = useState("WHATSAPP");
  const [arabicSpeaking, setArabicSpeaking] = useState(false);

  const [currency, setCurrency] = useState("SAR");
  const [paymentTerms, setPaymentTerms] = useState("PAY_AFTER_CONFIRMATION");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setSupplierCode("");
    setCodeTouched(false);
    setSupplierType("BROKER");
    setServiceCategories([]);
    setStatus("ACTIVE");
    setCity("");
    setCountry("Saudi Arabia");
    setContactName("");
    setWhatsapp("");
    setEmail("");
    setPreferredChannel("WHATSAPP");
    setArabicSpeaking(false);
    setCurrency("SAR");
    setPaymentTerms("PAY_AFTER_CONFIRMATION");
    setLeadTimeDays("");
    setInternalNotes("");
    setError(null);
  };

  useResetOnOpen(open, "add-supplier", reset);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!codeTouched) setSupplierCode(suggestCode(value, city));
  };

  const duplicateWarning = useMemo(() => {
    if (!name.trim()) return null;
    const q = name.trim().toLowerCase();
    const match = suppliers.find(
      (s) => s.name.toLowerCase() === q || s.name.toLowerCase().includes(q),
    );
    return match
      ? `A supplier named "${match.name}" already exists — check before creating a duplicate.`
      : null;
  }, [name, suppliers]);

  const toggleCategory = (category: string) => {
    setServiceCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );
  };

  const submit = async () => {
    setSubmitting(true);
    const result = await createSupplier({
      name,
      supplierCode,
      supplierType: supplierType as never,
      serviceCategories: serviceCategories as never,
      status,
      city,
      country,
      contactName,
      whatsappNumber: whatsapp,
      email,
      preferredChannel: preferredChannel as never,
      arabicSpeaking,
      currency: currency as never,
      paymentTerms: paymentTerms as never,
      leadTimeDays: leadTimeDays.trim() ? Number(leadTimeDays) : null,
      internalNotes,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create the supplier.");
      return;
    }
    toast.add({
      title: "Supplier added",
      description: `${name} has been added to the directory.`,
    });
    reset();
    onClose();
  };

  const canSubmit = name.trim() && supplierCode.trim() && whatsapp.trim();

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className=" custom-scroll min-w-xl gap-0">
        <SheetHeader>
          <SheetTitle>Add Supplier</SheetTitle>
          <SheetDescription>
            Add a reusable partner to the directory — brokers, hotels,
            transport, catering and other service providers Operations selects
            when executing Departure Groups.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col overflow-y-auto custom-scroll gap-6 px-4 py-4">
          {/* Basic information */}
          <SectionHeading title="Basic information" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Field label="Supplier / Company Name *">
                <InputGroupInput
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Al Noor Travel Services"
                />
              </Field>
              {duplicateWarning && (
                <p className={cn("text-xs", TONE_TEXT.warning)}>
                  {duplicateWarning}
                </p>
              )}
            </div>
            <Field label="Supplier Code *">
              <InputGroupInput
                value={supplierCode}
                onChange={(e) => {
                  setCodeTouched(true);
                  setSupplierCode(e.target.value);
                }}
                placeholder="SUP-MAK-001"
              />
            </Field>
            <SelectDropdown
              label="Supplier Type *"
              value={supplierType}
              onChange={setSupplierType}
              options={SUPPLIER_TYPES.map((v) => ({
                value: v,
                label: SUPPLIER_TYPE_LABELS[v],
              }))}
            />
            <SelectDropdown
              label="Status *"
              value={status}
              onChange={(v) => setStatus(v as "ACTIVE" | "INACTIVE")}
              options={[
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive" },
              ]}
            />
            <div className="col-span-2">
              <Field label="Service Categories *">
                <div className="grid grid-cols-2 gap-3.5 w-full p-2  overflow-y-auto custom-scroll">
                  {SERVICE_CATEGORIES.map((category) => (
                    <label
                      key={category}
                      className="flex items-center gap-2 text-xs text-foreground cursor-pointer"
                    >
                      <Checkbox
                        checked={serviceCategories.includes(category)}
                        onCheckedChange={() => toggleCategory(category)}
                      />
                      {SERVICE_CATEGORY_LABELS[category]}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          </div>

          {/* Location and contacts */}
          <SectionHeading title="Location and contacts" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Primary City / Region">
              <InputGroupInput
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Makkah"
              />
            </Field>
            <Field label="Country">
              <InputGroupInput
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Saudi Arabia"
              />
            </Field>
            <Field label="Primary Contact Name">
              <InputGroupInput
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Ahmed Al Noor"
              />
            </Field>
            <Field label="WhatsApp / Phone *">
              <InputGroupInput
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="+966 5xx xxx xxxx"
              />
            </Field>
            <Field label="Email">
              <InputGroupInput
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@supplier.com"
              />
            </Field>
            <SelectDropdown
              label="Preferred Communication Channel"
              value={preferredChannel}
              onChange={setPreferredChannel}
              options={CHANNELS.map((v) => ({
                value: v,
                label: PREFERRED_CHANNEL_LABELS[v],
              }))}
            />
            <Card className="flex flex-row col-span-2 items-center justify-between px-4 py-3">
              <span className="text-xs font-medium text-foreground">
                Arabic-speaking contact?
              </span>
              <Switch
                checked={arabicSpeaking}
                onCheckedChange={setArabicSpeaking}
              />
            </Card>
          </div>

          {/* Commercial setup */}
          {can.viewCosts && (
            <div className="flex flex-col gap-3">
              <SectionHeading
                title="Commercial setup
"
              />
              <SelectDropdown
                value={currency}
                label="Supported Currency"
                onChange={setCurrency}
                options={CURRENCIES.map((v) => ({
                  value: v,
                  label: CURRENCY_LABELS[v],
                }))}
              />
              <SelectDropdown
                value={paymentTerms}
                label="Payment Terms"
                onChange={setPaymentTerms}
                options={PAYMENT_TERMS.map((v) => ({
                  value: v,
                  label: PAYMENT_TERMS_LABELS[v],
                }))}
              />
              <Field label="Usual Lead Time (days)">
                <InputGroupInput
                  type="number"
                  min={0}
                  value={leadTimeDays}
                  onChange={(e) => setLeadTimeDays(e.target.value)}
                  placeholder="7"
                />
              </Field>
              {can.viewInternalNotes && (
                <Field label="Internal Notes">
                  <InputGroupTextarea
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    placeholder='"Best for Makkah hotel availability during Ramadan."'
                  />
                </Field>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !canSubmit}>
            {submitting ? "Creating…" : "Add Supplier"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <InputGroup>
      <InputGroupAddon align={"block-start"}>
        <InputGroupText>{label}</InputGroupText>
      </InputGroupAddon>

      {children}
    </InputGroup>
  );
}

function SelectDropdown({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <InputGroup className="cursor-pointer">
          <InputGroupAddon align={"block-start"}>
            <InputGroupText>{label}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            readOnly
            value={selected?.label ?? ""}
            className="cursor-pointer"
          />
        </InputGroup>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-56 max-h-72 overflow-y-auto custom-scroll"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
