"use client";

import { Landmark } from "lucide-react";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import InputFormCard from "@/components/ui/input-form-card";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import type { ApprovedPaymentAccount } from "@/lib/data/agency-payment-accounts-repository";

import { addApprovedPaymentAccountAction, setApprovedPaymentAccountActiveAction } from "./payment-accounts-actions";

/**
 * The bank accounts your agency really uses — MI4.1. When a customer quotes an account number that is NOT on this list, the Inbox
 * warns your team before anyone replies, because a wrong account is how customers get defrauded. Until you list your accounts,
 * every account number a customer mentions is treated as unverified.
 */
export function ApprovedPaymentAccountsCard({ accounts, canEdit }: { accounts: ApprovedPaymentAccount[]; canEdit: boolean }) {
  const [label, setLabel] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startSaving] = useTransition();

  function add() {
    setError(null);
    startSaving(async () => {
      const result = await addApprovedPaymentAccountAction({ label, bankName, accountNumber });
      if (!result.ok) {
        setError(result.error ?? "The account was not added.");
        return;
      }
      setLabel("");
      setBankName("");
      setAccountNumber("");
      toast.add({ title: "Account added", description: "Customers quoting this account are no longer flagged." });
    });
  }

  function toggle(account: ApprovedPaymentAccount) {
    setError(null);
    startSaving(async () => {
      const result = await setApprovedPaymentAccountActiveAction({ accountId: account.id, active: !account.active });
      if (!result.ok) setError(result.error ?? "The account was not updated.");
    });
  }

  return (
    <InputFormCard
      title="Approved bank accounts"
      icon={<Landmark className="size-4" />}
      desc="The only accounts your team may give customers to pay into. Anything else a customer quotes is flagged."
    >
      {accounts.length === 0
        ? <p className="mt-2 text-sm text-muted-foreground">No accounts listed yet, so every account number a customer mentions is flagged for review.</p>
        : (
          <ul className="mt-2 space-y-2">
            {accounts.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{account.label}</span>
                  {account.bankName && <span className="text-muted-foreground"> · {account.bankName}</span>}
                  <span className="font-number text-muted-foreground"> · {account.maskedAccount}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={account.active ? "secondary" : "outline"}>{account.active ? "In use" : "Switched off"}</Badge>
                  {canEdit && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => toggle(account)}>{account.active ? "Switch off" : "Switch on"}</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      {canEdit && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <InputGroup>
            <InputGroupAddon align="block-start"><InputGroupText>Account name</InputGroupText></InputGroupAddon>
            <InputGroupInput value={label} disabled={pending} placeholder="Main receiving account" onChange={(event) => setLabel(event.target.value)} />
          </InputGroup>
          <InputGroup>
            <InputGroupAddon align="block-start"><InputGroupText>Bank (optional)</InputGroupText></InputGroupAddon>
            <InputGroupInput value={bankName} disabled={pending} onChange={(event) => setBankName(event.target.value)} />
          </InputGroup>
          <InputGroup>
            <InputGroupAddon align="block-start"><InputGroupText>Account number</InputGroupText></InputGroupAddon>
            <InputGroupInput inputMode="numeric" autoComplete="off" value={accountNumber} disabled={pending} onChange={(event) => setAccountNumber(event.target.value)} />
          </InputGroup>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <Button onClick={add} disabled={pending || label.trim() === "" || accountNumber.trim() === ""}>{pending ? "Saving…" : "Add account"}</Button>
        </div>
      )}
      {!canEdit && <p className="mt-2 text-xs text-muted-foreground">Only Finance and admins can change this list.</p>}
    </InputFormCard>
  );
}
