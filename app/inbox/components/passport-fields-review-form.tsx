"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { passportFormDefaults } from "@/lib/inbox/passport-fields";

import { applyPassportDetailsAction } from "../actions";

/**
 * "Review fields": the passport number and expiry the model read, pre-filled and editable. A person checks them against the
 * photo and confirms; only then are they written to the traveller's record. The server finds the traveller from the passport.
 */
export function PassportFieldsReviewForm({
  attachmentId,
  candidateFields,
  disabledReason,
}: {
  attachmentId: string;
  candidateFields: Record<string, unknown>;
  disabledReason: string | null;
}) {
  const defaults = passportFormDefaults(candidateFields);
  const [open, setOpen] = useState(false);
  const [passportNumber, setPassportNumber] = useState(defaults.passportNumber);
  const [expiryDate, setExpiryDate] = useState(defaults.expiryDate);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    setMessage(null);
    startTransition(async () => {
      const result = await applyPassportDetailsAction({ attachmentId, passportNumber, expiryDate });
      if (result.ok) {
        setMessage({ ok: true, text: "Saved to the traveller's record." });
        setOpen(false);
      } else {
        setMessage({ ok: false, text: result.error });
      }
    });
  }

  return (
    <div className="mt-3 space-y-2">
      {!open ? (
        <Button type="button" size="sm" variant="secondary" disabled={disabledReason !== null} onClick={() => setOpen(true)}>
          Review fields
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Check these against the passport photo. They are saved to the traveller only when you confirm.</p>
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Passport number</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput value={passportNumber} onChange={(event) => setPassportNumber(event.target.value)} autoComplete="off" aria-label="Passport number" />
          </InputGroup>
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Expiry date</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} aria-label="Passport expiry date" />
          </InputGroup>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={isPending || !passportNumber.trim() || !expiryDate} onClick={confirm}>
              {isPending ? "Saving…" : "Save to traveller record"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
      {message && (
        <p className={message.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
