"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";

import { eraseTravellerDataAction } from "../../actions";

const CONFIRM_WORD = "ERASE";

interface EraseTravellerDataDialogProps {
  traveller: { id: string; fullName: string } | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Erases one traveller's passport, contact and file details at their request.
 * Permanent, so the person has to type the word ERASE; what goes and what stays is
 * spelled out first, in plain words.
 */
const EraseTravellerDataDialog = ({
  traveller,
  departureGroupId,
  open,
  onClose,
}: EraseTravellerDataDialogProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, traveller?.id ?? "", () => {
    setTyped("");
    setError(null);
  });

  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

  const submit = () => {
    if (!traveller || !confirmed) return;
    setError(null);
    startTransition(async () => {
      const result = await eraseTravellerDataAction({
        departureGroupId,
        pilgrimId: traveller.id,
        confirm: true,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.add({
        title: "Sensitive details erased",
        description: `${traveller.fullName}: ${result.filesRemoved} stored file${
          result.filesRemoved === 1 ? "" : "s"
        } removed.`,
      });
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Erase sensitive details?</DialogTitle>
          <DialogDescription>
            {traveller ? `${traveller.fullName}. ` : ""}This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm text-foreground">
          <div>
            <p className="font-medium">What will be erased</p>
            <p className="text-muted-foreground">
              Passport number, expiry and country, date of birth, phone number,
              emergency contact, the visa number, and every uploaded file
              (passport, visa and ticket) along with what the AI review read
              from them.
            </p>
          </div>
          <div>
            <p className="font-medium">What stays</p>
            <p className="text-muted-foreground">
              The traveller&apos;s name, their booking, payments and invoices,
              and a record that the erasure happened.
            </p>
          </div>
          <p className="text-muted-foreground">
            This is only allowed once the trip has finished or the booking was
            cancelled.
          </p>

          <InputGroup>
            <InputGroupAddon align="block-start">
              Type {CONFIRM_WORD} to confirm
            </InputGroupAddon>
            <InputGroupInput
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              disabled={isPending}
            />
          </InputGroup>

          {error && (
            <p className="flex items-start gap-2 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline_without_border" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={!confirmed || isPending}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Erase Details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EraseTravellerDataDialog;
