import { Receipt } from "lucide-react";

import { Input } from "@/components/ui/input";
import InputFormCard from "@/components/ui/input-form-card";
import { Textarea } from "@/components/ui/textarea";
import { REFERENCE_PREFIX_FIELDS } from "@/lib/data/settings-copy";
import { previewReferenceNumber } from "@/lib/data/settings";

import { Field } from "../components/field";
import { SettingToggleRow } from "../components/setting-toggle-row";

export interface PrefixValues {
  invoicePrefix: string;
  receiptPrefix: string;
  paymentPrefix: string;
  supplierBillPrefix: string;
}

export function InvoiceSettingsCard({
  prefixes,
  onPrefixChange,
  invoiceFooter,
  onInvoiceFooterChange,
  autoGenerateReceipt,
  onAutoGenerateReceiptChange,
  requireBankProof,
  onRequireBankProofChange,
  canEdit,
  fieldErrors,
}: {
  prefixes: PrefixValues;
  onPrefixChange: (key: keyof PrefixValues, value: string) => void;
  invoiceFooter: string;
  onInvoiceFooterChange: (value: string) => void;
  autoGenerateReceipt: boolean;
  onAutoGenerateReceiptChange: (value: boolean) => void;
  requireBankProof: boolean;
  onRequireBankProofChange: (value: boolean) => void;
  canEdit: boolean;
  fieldErrors: Record<string, string>;
}) {
  return (
    <InputFormCard title="Invoice settings" icon={<Receipt className="size-4" />}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        {REFERENCE_PREFIX_FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            hint={`Next: ${previewReferenceNumber(prefixes[field.key])}`}
            error={fieldErrors[field.key]}
          >
            <Input
              value={prefixes[field.key]}
              onChange={(e) => onPrefixChange(field.key, e.target.value.toUpperCase())}
              disabled={!canEdit}
            />
          </Field>
        ))}
      </div>

      <div className="mt-3">
        <Field label="Invoice Footer">
          <Textarea value={invoiceFooter} onChange={(e) => onInvoiceFooterChange(e.target.value)} disabled={!canEdit} />
        </Field>
      </div>

      <div className="flex flex-col divide-y divide-border/20 mt-2">
        <SettingToggleRow
          label="Generate receipt automatically when payment is recorded"
          checked={autoGenerateReceipt}
          onCheckedChange={onAutoGenerateReceiptChange}
          disabled={!canEdit}
        />
        <SettingToggleRow
          label="Require payment proof for bank transfers"
          checked={requireBankProof}
          onCheckedChange={onRequireBankProofChange}
          disabled={!canEdit}
        />
      </div>
    </InputFormCard>
  );
}
