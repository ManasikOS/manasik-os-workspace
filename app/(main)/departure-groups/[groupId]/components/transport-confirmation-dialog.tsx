"use client";

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
  InputGroupText,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { transportConfirmationSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { setTransportConfirmationAction } from "../../actions";
import type { DepartureGroupTransport } from "../../types";

interface TransportConfirmationDialogProps {
  transport: DepartureGroupTransport | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

/** Attaches a confirmation link to a transport route ("Upload Confirmation"). */
const TransportConfirmationDialog = ({
  transport,
  departureGroupId,
  open,
  onClose,
}: TransportConfirmationDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [confirmationUrl, setConfirmationUrl] = useState(
    transport?.confirmationUrl ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, transport?.id ?? "", () => {
    setConfirmationUrl(transport?.confirmationUrl ?? "");
    setError(null);
  });

  const submit = () => {
    setError(null);

    const payload = {
      id: transport?.id ?? "",
      departureGroupId,
      confirmationUrl: confirmationUrl.trim(),
    };

    const check = transportConfirmationSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That link is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await setTransportConfirmationAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Confirmation attached",
        description: result.routeLabel,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Upload Confirmation</DialogTitle>
          <DialogDescription>{transport?.routeLabel}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>
                Confirmation URL <span className="text-destructive">*</span>
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={confirmationUrl}
              onChange={(e) => setConfirmationUrl(e.target.value)}
              placeholder="https://…"
              autoFocus
            />
          </InputGroup>
          <p className="text-[11px] text-muted-foreground">
            Paste a link to the transport confirmation document (Drive, email
            attachment, or supplier portal).
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={isPending} onClick={submit}>
            {isPending && <Loader2 className="animate-spin" />}
            Save Confirmation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TransportConfirmationDialog;
