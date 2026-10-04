"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { INTEGRATION_LABELS } from "@/lib/data/settings-copy";
import type { IntegrationConnectionRow } from "@/lib/types/settings";

import { updateIntegrationNotesAction } from "../actions";
import { Field } from "../components/field";

/**
 * There is no OAuth flow behind this yet (D9) — the sheet is honest about
 * that and captures only a notes field an Admin can use to track manual
 * setup steps, never a credential.
 */
export function ConnectIntegrationSheet({
  integration,
  open,
  onClose,
  onSaved,
}: {
  integration: IntegrationConnectionRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(integration?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, integration?.id ?? "none", () => {
    setNotes(integration?.notes ?? "");
    setError(null);
  });

  if (!integration) return null;

  const submit = async () => {
    setSubmitting(true);
    setError(null);

    const result = await updateIntegrationNotesAction({ provider: integration.provider, notes });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }

    toast.add({ title: "Notes saved" });
    onSaved();
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="max-w-md gap-4">
        <SheetHeader>
          <SheetTitle>{INTEGRATION_LABELS[integration.provider]}</SheetTitle>
          <SheetDescription>
            No live connector exists for this provider yet — connecting it needs engineering work.
            Use the notes field to track setup requirements or manual-workflow steps in the
            meantime.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4">
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} />
          </Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />} Save Notes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
