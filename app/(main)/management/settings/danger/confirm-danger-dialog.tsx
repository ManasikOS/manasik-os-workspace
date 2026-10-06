"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

/**
 * The one confirmation shape every Danger Zone action shares: a typed
 * phrase, never a plain OK/Cancel. See D13 — these actions never sit beside
 * a normal Save button, and this dialog is the reason they can't be
 * triggered by a stray click.
 */
export function ConfirmDangerDialog({
  open,
  title,
  description,
  confirmLabel,
  expectedText,
  expectedHint,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** What the user must type, verbatim (case-insensitive), to enable the confirm button. */
  expectedText: string;
  expectedHint: string;
  onClose: () => void;
  onConfirm: (typedText: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, title, () => {
    setTyped("");
    setError(null);
  });

  const matches =
    typed.trim().toUpperCase() === expectedText.trim().toUpperCase();

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await onConfirm(typed);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not complete this action.");
      return;
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <InputGroup>
            <InputGroupAddon align="block-start"><InputGroupText>{expectedHint}</InputGroupText></InputGroupAddon>
          <InputGroupInput
            aria-label={expectedHint}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expectedText}
          />
          </InputGroup>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={!matches || submitting}
          >
            {submitting && <Loader2 className="animate-spin" />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
