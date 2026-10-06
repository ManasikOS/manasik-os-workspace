"use client";

import { CircleDollarSign, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import InputFormCard from "@/components/ui/input-form-card";
import { InputGroupInput } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { CURRENCY_OPTIONS, PAYMENT_METHOD_LABELS } from "@/lib/data/settings-copy";
import type { AgencySettingsRow } from "@/lib/types/settings";

import { updateFinanceDefaultsAction } from "../actions";
import { Field } from "../components/field";
import { SectionShell } from "../components/section-shell";
import { SelectDropdown } from "../components/select-dropdown";
import { InvoiceSettingsCard, type PrefixValues } from "./invoice-settings-card";
import { MarginVisibilityCard } from "./margin-visibility-card";

const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS);

export function FinanceDefaultsForm({ settings, canEdit }: { settings: AgencySettingsRow; canEdit: boolean }) {
  const [defaultCurrency, setDefaultCurrency] = useState(settings.default_currency);
  const [supportedCurrencies, setSupportedCurrencies] = useState<string[]>(settings.supported_currencies);
  const [prefixes, setPrefixes] = useState<PrefixValues>({
    invoicePrefix: settings.invoice_prefix,
    receiptPrefix: settings.receipt_prefix,
    paymentPrefix: settings.payment_prefix,
    supplierBillPrefix: settings.supplier_bill_prefix,
  });
  const [defaultPaymentTerms, setDefaultPaymentTerms] = useState(settings.default_payment_terms);
  const [enabledPaymentMethods, setEnabledPaymentMethods] = useState<string[]>(settings.enabled_payment_methods);
  const [invoiceFooter, setInvoiceFooter] = useState(settings.invoice_footer);
  const [autoGenerateReceipt, setAutoGenerateReceipt] = useState(settings.auto_generate_receipt);
  const [requireBankProof, setRequireBankProof] = useState(settings.require_bank_proof);
  const [marginVisibleRoles, setMarginVisibleRoles] = useState<StaffRole[]>(settings.margin_visible_roles);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const togglePaymentMethod = (method: string) => {
    setEnabledPaymentMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method],
    );
  };

  const toggleCurrency = (value: string) => {
    setSupportedCurrencies((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const toggleMarginRole = (role: StaffRole, next: boolean) => {
    setMarginVisibleRoles((prev) => (next ? [...new Set([...prev, role])] : prev.filter((r) => r !== role)));
  };

  const save = async () => {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const result = await updateFinanceDefaultsAction({
      defaultCurrency,
      supportedCurrencies,
      invoicePrefix: prefixes.invoicePrefix,
      receiptPrefix: prefixes.receiptPrefix,
      paymentPrefix: prefixes.paymentPrefix,
      supplierBillPrefix: prefixes.supplierBillPrefix,
      defaultPaymentTerms,
      enabledPaymentMethods,
      invoiceFooter,
      autoGenerateReceipt,
      requireBankProof,
      marginVisibleRoles,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save Finance defaults.");
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    toast.add({ title: "Finance defaults saved" });
  };

  return (
    <SectionShell
      title="Finance Defaults"
      description="Currency, numbering, payment methods and who can see internal cost and margin."
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
      <InputFormCard title="Currency & payment terms" icon={<CircleDollarSign className="size-4" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Field label="Default Currency">
            <SelectDropdown value={defaultCurrency} onChange={setDefaultCurrency} options={CURRENCY_OPTIONS} disabled={!canEdit} />
          </Field>
          <Field label="Default Payment Terms">
            <InputGroupInput value={defaultPaymentTerms} onChange={(e) => setDefaultPaymentTerms(e.target.value)} disabled={!canEdit} />
          </Field>
        </div>

        <div className="mt-3">
          <span className="text-xs font-medium text-muted-foreground">Supported Currencies</span>
          <div className="flex flex-wrap gap-4 mt-2">
            {CURRENCY_OPTIONS.map((currency) => (
              <label key={currency.value} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <Checkbox
                  checked={supportedCurrencies.includes(currency.value)}
                  onCheckedChange={() => toggleCurrency(currency.value)}
                  disabled={!canEdit}
                />
                {currency.value}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <span className="text-xs font-medium text-muted-foreground">Default Payment Methods</span>
          <div className="flex flex-wrap gap-4 mt-2">
            {PAYMENT_METHODS.map((method) => (
              <label key={method} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <Checkbox
                  checked={enabledPaymentMethods.includes(method)}
                  onCheckedChange={() => togglePaymentMethod(method)}
                  disabled={!canEdit}
                />
                {PAYMENT_METHOD_LABELS[method]}
              </label>
            ))}
          </div>
          {fieldErrors.enabledPaymentMethods && (
            <p className="text-xs text-destructive mt-1">{fieldErrors.enabledPaymentMethods}</p>
          )}
        </div>
      </InputFormCard>

      <InvoiceSettingsCard
        prefixes={prefixes}
        onPrefixChange={(key, value) => setPrefixes((prev) => ({ ...prev, [key]: value }))}
        invoiceFooter={invoiceFooter}
        onInvoiceFooterChange={setInvoiceFooter}
        autoGenerateReceipt={autoGenerateReceipt}
        onAutoGenerateReceiptChange={setAutoGenerateReceipt}
        requireBankProof={requireBankProof}
        onRequireBankProofChange={setRequireBankProof}
        canEdit={canEdit}
        fieldErrors={fieldErrors}
      />

      <MarginVisibilityCard visibleRoles={marginVisibleRoles} onToggle={toggleMarginRole} canEdit={canEdit} />
    </SectionShell>
  );
}
