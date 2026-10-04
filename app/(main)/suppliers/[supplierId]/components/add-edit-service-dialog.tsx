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
import { CurrencyInput } from "@/components/ui/currency-input";
import { InputGroup } from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupInput } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { ChevronDown, Wrench } from "lucide-react";
import React, { useState } from "react";

import { CURRENCY_LABELS, SEASON_LABELS, SERVICE_CATEGORY_LABELS } from "@/lib/data/suppliers-copy";
import { upsertServiceAction } from "../../actions";
import type { SupplierServiceRow } from "../../types";

interface AddEditServiceDialogProps {
  supplierId: string;
  open: boolean;
  existing: SupplierServiceRow | null;
  availableCategories: string[];
  onClose: () => void;
}

const CURRENCIES = Object.keys(CURRENCY_LABELS).filter((c) => c !== "OTHER");
const SEASONS = Object.keys(SEASON_LABELS);

export default function AddEditServiceDialog({ supplierId, open, existing, availableCategories, onClose }: AddEditServiceDialogProps) {
  const [category, setCategory] = useState<string>(existing?.category ?? availableCategories[0] ?? "OTHER");
  const [typicalService, setTypicalService] = useState(existing?.typical_service ?? "");
  const [typicalRate, setTypicalRate] = useState<number | "">(existing?.typical_rate ?? "");
  const [rateCurrency, setRateCurrency] = useState<string>(existing?.rate_currency ?? "SAR");
  const [rateUnit, setRateUnit] = useState(existing?.rate_unit ?? "");
  const [season, setSeason] = useState<string>(existing?.season ?? "STANDARD");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(open, existing?.id ?? category, () => {
    setCategory(existing?.category ?? availableCategories[0] ?? "OTHER");
    setTypicalService(existing?.typical_service ?? "");
    setTypicalRate(existing?.typical_rate ?? "");
    setRateCurrency(existing?.rate_currency ?? "SAR");
    setRateUnit(existing?.rate_unit ?? "");
    setSeason(existing?.season ?? "STANDARD");
    setNotes(existing?.notes ?? "");
    setError(null);
  });

  const categoryOptions = existing ? [existing.category] : availableCategories;

  const submit = async () => {
    setSubmitting(true);
    const result = await upsertServiceAction({
      supplierId,
      category,
      typicalService,
      typicalRate: typicalRate === "" ? null : typicalRate,
      rateCurrency,
      rateUnit,
      season,
      notes,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save this service.");
      return;
    }
    toast.add({ title: "Service saved" });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <Wrench className="size-5 text-primary" />
            <DialogTitle>{existing ? "Edit Service" : "Add Service"}</DialogTitle>
          </div>
          <DialogDescription>Internal planning reference only — customer pricing lives in Package Templates.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="Service Category">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <InputGroup className="cursor-pointer">
                  <InputGroupInput readOnly value={SERVICE_CATEGORY_LABELS[category]} className="cursor-pointer" />
                  <ChevronDown className="size-4 text-muted-foreground mr-2" />
                </InputGroup>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56 max-h-72 overflow-y-auto custom-scroll">
                {categoryOptions.map((c) => (
                  <DropdownMenuItem key={c} onClick={() => setCategory(c)}>
                    {SERVICE_CATEGORY_LABELS[c]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>
          <Field label="Typical Service">
            <Input value={typicalService} onChange={(e) => setTypicalService(e.target.value)} placeholder="4-star hotel within 500m of Haram" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Typical Rate">
              <InputGroup>
                <CurrencyInput value={typicalRate} onValueChange={setTypicalRate} />
              </InputGroup>
            </Field>
            <Field label="Currency">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup className="cursor-pointer">
                    <InputGroupInput readOnly value={rateCurrency} className="cursor-pointer" />
                    <ChevronDown className="size-4 text-muted-foreground mr-2" />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {CURRENCIES.map((c) => (
                    <DropdownMenuItem key={c} onClick={() => setRateCurrency(c)}>
                      {c}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Field>
          </div>
          <Field label="Rate Unit">
            <Input value={rateUnit} onChange={(e) => setRateUnit(e.target.value)} placeholder="room / night" />
          </Field>
          <Field label="Applicable Season">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <InputGroup className="cursor-pointer">
                  <InputGroupInput readOnly value={SEASON_LABELS[season]} className="cursor-pointer" />
                  <ChevronDown className="size-4 text-muted-foreground mr-2" />
                </InputGroup>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {SEASONS.map((s) => (
                  <DropdownMenuItem key={s} onClick={() => setSeason(s)}>
                    {SEASON_LABELS[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Prices vary by room type and departure period." />
          </Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
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
