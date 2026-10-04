"use client";

import { Link2, Link2Off, Loader2 } from "lucide-react";
import React, { useEffect, useState, useTransition } from "react";

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import {
  listActiveSuppliersAction,
  type ActiveSupplierOption,
} from "@/app/(main)/departure-groups/actions";
import { SUPPLIER_TYPES_BY_CONTEXT } from "@/app/(main)/departure-groups/[groupId]/components/supplier-picker-types";

import { confirmSupplierServiceAction, recordSupplierDetailsAction } from "../actions";
import type { OperationsSupplierRow } from "../types";

interface RecordSupplierDetailsDialogProps {
  row: OperationsSupplierRow | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Records the supplier name and/or reference, then — once both are present —
 * lets staff confirm the service in the same step. The confirming mutator
 * (`markAccommodationConfirmedInStore` / `markTransportConfirmedInStore`)
 * enforces the evidence rule itself, so this dialog never bypasses it even if
 * a caller tries to.
 */
const RecordSupplierDetailsDialog = ({ row, open, onClose }: RecordSupplierDetailsDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [supplierName, setSupplierName] = useState("");
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierOptions, setSupplierOptions] = useState<ActiveSupplierOption[]>([]);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pickerContext = row?.serviceKind === "ACCOMMODATION" ? "ACCOMMODATION" : "TRANSPORT";

  useResetOnOpen(open, row?.id ?? "", () => {
    setSupplierName(row?.supplierName ?? "");
    setSupplierId(row?.supplierId ?? null);
    setReference(row?.reference ?? "");
    setError(null);
  });

  useEffect(() => {
    if (!open || !row) return;
    listActiveSuppliersAction([...SUPPLIER_TYPES_BY_CONTEXT[pickerContext]]).then((res) => {
      if (res.ok) setSupplierOptions(res.suppliers);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pickerContext derives from row, already a dependency via row?.id in useResetOnOpen
  }, [open, row?.id]);

  if (!row) return null;

  const saveDetails = (thenConfirm: boolean) => {
    setError(null);
    startTransition(async () => {
      const result = await recordSupplierDetailsAction({
        id: row.id,
        departureGroupId: row.groupId,
        serviceKind: row.serviceKind,
        serviceLabel: row.serviceLabel,
        supplierName: supplierName.trim() || undefined,
        supplierId,
        bookingReference: reference.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "Could not save supplier details.");
        return;
      }

      if (thenConfirm) {
        const confirmResult = await confirmSupplierServiceAction({
          id: row.id,
          departureGroupId: row.groupId,
          serviceKind: row.serviceKind,
        });
        if (!confirmResult.ok) {
          setError(confirmResult.error ?? "Details saved, but confirming failed.");
          return;
        }
        toast.add({ title: "Supplier confirmed", description: row.serviceLabel });
      } else {
        toast.add({ title: "Supplier details recorded" });
      }
      onClose();
    });
  };

  const canConfirm = supplierName.trim().length > 0 && reference.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Update Supplier</DialogTitle>
          <DialogDescription>
            {row.groupName} · {row.serviceLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <InputGroup>
                  <InputGroupAddon align="block-start">
                    <InputGroupText>Supplier</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    readOnly
                    autoFocus
                    value={supplierName || "No supplier assigned"}
                    className={supplierName ? undefined : "text-muted-foreground"}
                  />
                </InputGroup>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56 max-h-64 overflow-y-auto">
                {supplierId && (
                  <DropdownMenuItem
                    onClick={() => {
                      setSupplierId(null);
                      setSupplierName("");
                    }}
                    className="text-muted-foreground"
                  >
                    <Link2Off className="size-3.5" /> Clear supplier
                  </DropdownMenuItem>
                )}
                {supplierOptions.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground max-w-56">
                    No matching suppliers in your directory yet.
                  </div>
                ) : (
                  supplierOptions.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      onClick={() => {
                        setSupplierName(s.name);
                        setSupplierId(s.id);
                      }}
                    >
                      {supplierId === s.id && <Link2 className="size-3.5" />}
                      {s.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {supplierOptions.length === 0 && (
              <a
                href="/suppliers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-primary hover:underline"
              >
                Add a supplier to your Supplier Directory →
              </a>
            )}
          </div>
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Booking Reference</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PNR, contract or confirmation number" />
          </InputGroup>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {!canConfirm && (
            <p className="text-[11px] text-muted-foreground">
              Confirming requires both a supplier name and a reference — this cannot be marked confirmed on a bare status flip.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline_without_border" disabled={isPending} onClick={() => saveDetails(false)}>
            {isPending && <Loader2 className="animate-spin" />} Save Details
          </Button>
          <Button disabled={isPending || !canConfirm} onClick={() => saveDetails(true)}>
            {isPending && <Loader2 className="animate-spin" />} Save &amp; Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RecordSupplierDetailsDialog;
