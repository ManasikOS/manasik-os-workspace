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
import { accommodationVoucherSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { setAccommodationVoucherAction } from "../../actions";
import type { DepartureGroupAccommodation } from "../../types";

interface AccommodationVoucherDialogProps {
  accommodation: DepartureGroupAccommodation | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

/** Attaches a voucher link to an accommodation block ("Upload Voucher"). */
const AccommodationVoucherDialog = ({
  accommodation,
  departureGroupId,
  open,
  onClose,
}: AccommodationVoucherDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [voucherUrl, setVoucherUrl] = useState(accommodation?.voucherUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, accommodation?.id ?? "", () => {
    setVoucherUrl(accommodation?.voucherUrl ?? "");
    setError(null);
  });

  const submit = () => {
    setError(null);

    const payload = {
      id: accommodation?.id ?? "",
      departureGroupId,
      voucherUrl: voucherUrl.trim(),
    };

    const check = accommodationVoucherSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That link is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await setAccommodationVoucherAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Voucher attached",
        description: result.hotelName,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Upload Voucher</DialogTitle>
          <DialogDescription>{accommodation?.hotelName}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>
                Voucher URL <span className="text-destructive">*</span>
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={voucherUrl}
              onChange={(e) => setVoucherUrl(e.target.value)}
              placeholder="https://…"
              autoFocus
            />
          </InputGroup>
          <p className="text-[11px] text-muted-foreground">
            Paste a link to the voucher document (Drive, email attachment, or
            supplier portal).
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
            Save Voucher
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AccommodationVoucherDialog;
