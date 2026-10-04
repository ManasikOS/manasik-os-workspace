"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";

import { assignVisaOfficerForPassportAction, loadVisaOfficersAction } from "../actions";

const NO_OFFICER = "no-officer";

/**
 * "Assign visa officer" on a passport: opens a short list of colleagues who do visa work, read only when it is first
 * opened, and gives the traveller's visa file to the one chosen. The traveller is worked out on the server from the passport.
 */
export function PassportVisaOfficerControl({ attachmentId, disabledReason }: { attachmentId: string; disabledReason: string | null }) {
  const [officers, setOfficers] = useState<Array<{ id: string; name: string }> | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openPicker() {
    setOpen(true);
    setMessage(null);
    if (officers) return;
    startTransition(async () => {
      const result = await loadVisaOfficersAction();
      if (result.ok) setOfficers(result.officers);
      else setMessage(result.error);
    });
  }

  function choose(value: string | null) {
    const officerId = !value || value === NO_OFFICER ? null : value;
    startTransition(async () => {
      const result = await assignVisaOfficerForPassportAction({ attachmentId, officerId });
      if (!result.ok) {
        toast.add({ title: "Could not assign the visa officer", description: result.error });
        return;
      }
      const name = officers?.find((officer) => officer.id === officerId)?.name;
      setMessage(officerId ? `Visa file given to ${name ?? "the officer"}.` : "Visa officer removed.");
      setOpen(false);
    });
  }

  return (
    <div className="mt-3 space-y-1">
      {!open ? (
        <Button type="button" size="sm" variant="secondary" disabled={isPending || disabledReason !== null} onClick={openPicker}>
          Assign visa officer
        </Button>
      ) : (
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Visa officer</InputGroupText>
          </InputGroupAddon>
          <Select onValueChange={choose} disabled={isPending || !officers}>
            <SelectTrigger className="w-full" aria-label="Visa officer">
              <SelectValue placeholder={officers ? "Choose an officer" : "Loading officers…"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_OFFICER}>No officer</SelectItem>
              {(officers ?? []).map((officer) => (
                <SelectItem key={officer.id} value={officer.id}>
                  {officer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InputGroup>
      )}
      {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
      {message && (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
