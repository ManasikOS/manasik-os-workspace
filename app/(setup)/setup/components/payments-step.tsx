"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import type { ApprovedPaymentAccount } from "@/lib/data/agency-payment-accounts-repository";

import { addSetupPaymentAccountAction } from "../actions";

/** Step 5. Adds the bank accounts pilgrims pay into. Only the last four digits are ever shown back. */
export function PaymentsStep({ accounts }: { accounts: ApprovedPaymentAccount[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ label: "", bankName: "", accountNumber: "" });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isSaving, startSaving] = useTransition();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startSaving(async () => {
      const result = await addSetupPaymentAccountAction(form);
      setMessage({ ok: result.ok, text: result.ok ? (result.message ?? "Added.") : result.error });
      if (result.ok) {
        setForm({ label: "", bankName: "", accountNumber: "" });
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {accounts.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Bank accounts you have added">
          {accounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium text-foreground">{account.label}</span>
              <span className="text-muted-foreground">
                {account.bankName ? `${account.bankName} · ` : ""}
                {account.maskedAccount}
                {account.active ? "" : " · Turned off"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Account name</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput value={form.label} onChange={(event) => setForm((previous) => ({ ...previous, label: event.target.value }))} placeholder="Main current account" required />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Bank name</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput value={form.bankName} onChange={(event) => setForm((previous) => ({ ...previous, bankName: event.target.value }))} placeholder="Optional" />
        </InputGroup>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Account number</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            value={form.accountNumber}
            onChange={(event) => setForm((previous) => ({ ...previous, accountNumber: event.target.value }))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="6 to 20 digits"
            required
          />
        </InputGroup>
        <p className="text-xs text-muted-foreground">
          We use this to check that a payment slip was paid into one of your own accounts. Invoice numbering and other money settings are in{" "}
          <Link href="/management/settings/finance" className="underline underline-offset-2">
            finance settings
          </Link>
          .
        </p>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>
            {message.text}
          </p>
        )}
        <Button type="submit" className="self-start" disabled={isSaving}>
          {isSaving && <Loader2Icon className="animate-spin" />} Add bank account
        </Button>
      </form>
    </div>
  );
}
