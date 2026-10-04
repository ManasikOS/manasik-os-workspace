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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState } from "react";

import { useOperations } from "../operations-store";

interface AddSupplierBookingDialogProps {
  open: boolean;
  onClose: () => void;
}

const KINDS: { value: "hotels" | "transport"; label: string }[] = [
  { value: "hotels", label: "Accommodation" },
  { value: "transport", label: "Transport" },
];

/**
 * A new supplier booking belongs to one specific group's Hotels or Transport
 * tab — that is where hotel name, dates and vehicle details are captured,
 * and this dialog does not duplicate that form. It only picks the group and
 * the service, then hands off.
 */
const AddSupplierBookingDialog = ({
  open,
  onClose,
}: AddSupplierBookingDialogProps) => {
  const router = useRouter();
  const { snapshot } = useOperations();

  const [groupId, setGroupId] = useState<string>(snapshot.groups[0]?.id ?? "");
  const [kind, setKind] = useState<"hotels" | "transport">("hotels");

  useResetOnOpen(open, "add-supplier", () => {
    setGroupId(snapshot.groups[0]?.id ?? "");
    setKind("hotels");
  });

  const group = snapshot.groups.find((g) => g.id === groupId);

  const proceed = () => {
    if (!groupId) return;
    router.push(`/departure-groups/${groupId}?tab=${kind}`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Add Supplier Booking</DialogTitle>
          <DialogDescription>
            Choose the group and service — the full booking form lives on that
            group&apos;s tab.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Departure Group</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  readOnly
                  value={
                    group
                      ? `${group.groupName} (${group.groupCode})`
                      : "Choose a group"
                  }
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="min-w-72 max-h-72 overflow-y-auto custom-scroll"
            >
              {snapshot.groups.map((g) => (
                <DropdownMenuItem key={g.id} onClick={() => setGroupId(g.id)}>
                  {g.groupName} ({g.groupCode})
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger>
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Service</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  readOnly
                  value={KINDS.find((k) => k.value === kind)?.label ?? ""}
                />
              </InputGroup>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {KINDS.map((k) => (
                <DropdownMenuItem
                  key={k.value}
                  onClick={() => setKind(k.value)}
                >
                  {k.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <DialogFooter className="">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!groupId} onClick={proceed}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddSupplierBookingDialog;
