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
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { UserPlus } from "lucide-react";
import React, { useState } from "react";

import { usePilgrims } from "../pilgrims-store";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

/**
 * Manual "Add Pilgrim" — for walk-ins, data migration and corrections. Most
 * pilgrims arrive automatically from a Booking; this creates a standalone
 * person record only (see `createPilgrimAction`).
 */
export default function AddPilgrimDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { createPilgrim } = usePilgrims();
  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [passport, setPassport] = useState("");
  const [city, setCity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFullName("");
    setWhatsapp("");
    setPassport("");
    setCity("");
    setError(null);
  };

  const submit = async () => {
    setSubmitting(true);
    const result = await createPilgrim({
      fullName,
      whatsappNumber: whatsapp,
      passportNumber: passport,
      city,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create the pilgrim record.");
      return;
    }
    toast.add({
      title: "Pilgrim record created",
      description: `${fullName} has been added.`,
    });
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <DialogTitle>Add Pilgrim</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground">
            Creates a standalone traveller record for walk-ins, data migration,
            or corrections. A pilgrim linked to a booking is created
            automatically from Departure Groups.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText> Full name</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Mohamed"
            />
          </InputGroup>
          <InputGroup className="">
            <InputGroupAddon align={"block-start"}>
              <InputGroupText> WhatsApp / mobile</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="77 123 4567"
            />
          </InputGroup>
          <InputGroup className="">
            <InputGroupAddon align={"block-start"}>
              <InputGroupText> Passport number</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={passport}
              onChange={(e) => setPassport(e.target.value)}
              placeholder="N1234567"
            />
          </InputGroup>
          <InputGroup className="">
            <InputGroupAddon align={"block-start"}>
              <InputGroupText> City</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Colombo"
            />
          </InputGroup>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !fullName.trim() || !whatsapp.trim()}
          >
            {submitting ? "Creating…" : "Create Pilgrim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
