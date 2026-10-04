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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { UserPlus } from "lucide-react";
import React, { useState } from "react";

import { upsertContactAction } from "../../actions";
import type { SupplierContactRow } from "../../types";

interface AddEditContactDialogProps {
  supplierId: string;
  open: boolean;
  existing: SupplierContactRow | null;
  onClose: () => void;
}

export default function AddEditContactDialog({ supplierId, open, existing, onClose }: AddEditContactDialogProps) {
  const [name, setName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [languages, setLanguages] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isEmergency, setIsEmergency] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, existing?.id ?? "new", () => {
    setName(existing?.name ?? "");
    setRoleTitle(existing?.role_title ?? "");
    setWhatsapp(existing?.whatsapp_number ?? "");
    setPhone(existing?.phone_number ?? "");
    setEmail(existing?.email ?? "");
    setLanguages(existing?.languages ?? "");
    setIsPrimary(existing?.is_primary ?? false);
    setIsEmergency(existing?.is_emergency ?? false);
    setNotes(existing?.notes ?? "");
    setError(null);
  });

  const submit = async () => {
    setSubmitting(true);
    const result = await upsertContactAction({
      contactId: existing?.id,
      supplierId,
      name,
      roleTitle,
      whatsappNumber: whatsapp,
      phoneNumber: phone,
      email,
      languages,
      isPrimary,
      isEmergency,
      notes,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save this contact.");
      return;
    }
    toast.add({ title: "Contact saved" });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <UserPlus className="size-5 text-primary" />
            <DialogTitle>{existing ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </div>
          <DialogDescription>A supplier can have multiple operational contacts.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="Name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ahmed Al Noor" />
          </Field>
          <Field label="Role">
            <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Operations Manager" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="WhatsApp">
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+966 ..." />
            </Field>
            <Field label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+966 ..." />
            </Field>
          </div>
          <Field label="Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@supplier.com" />
          </Field>
          <Field label="Languages">
            <Input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="Arabic / English" />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2">
            <span className="text-xs font-medium text-foreground">Primary Contact</span>
            <Switch checked={isPrimary} onCheckedChange={setIsPrimary} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2">
            <span className="text-xs font-medium text-foreground">Emergency Contact</span>
            <Switch checked={isEmergency} onCheckedChange={setIsEmergency} />
          </div>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Available 24/7 during group movements." />
          </Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Saving…" : "Save Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
