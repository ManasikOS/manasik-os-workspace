"use client";

import SectionHeading from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { TONE_CLASS } from "@/lib/ui/tone";
import { Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import React, { useState, useTransition } from "react";

import type { ServiceAddonRow } from "@/lib/data/service-addons";
import {
  deleteServiceAddonAction,
  toggleAddonActiveAction,
  upsertServiceAddonAction,
} from "./actions";

const CATEGORIES = [
  { value: "ACCOMMODATION", label: "Accommodation" },
  { value: "FLIGHT", label: "Flight" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "RITUAL", label: "Ritual" },
  { value: "ASSISTANCE", label: "Assistance" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "MERCHANDISE", label: "Merchandise" },
  { value: "OTHER", label: "Other" },
];

const UNITS = [
  { value: "FLAT", label: "Flat fee" },
  { value: "PER_NIGHT", label: "Per night" },
  { value: "PER_DAY", label: "Per day" },
  { value: "PER_KG", label: "Per kg" },
];

const JOURNEY_TYPES = [
  { value: "HAJJ", label: "Hajj" },
  { value: "UMRAH", label: "Umrah" },
];

interface ServiceAddonsManagerProps {
  addons: ServiceAddonRow[];
  canEdit: boolean;
}

type FormState = {
  id?: string;
  code: string;
  name: string;
  description: string;
  category: string;
  defaultAmount: string;
  unit: string;
  createsDeviation: boolean;
  journeyTypes: string[];
};

const emptyForm: FormState = {
  code: "",
  name: "",
  description: "",
  category: "OTHER",
  defaultAmount: "",
  unit: "FLAT",
  createsDeviation: false,
  journeyTypes: ["HAJJ", "UMRAH"],
};

function addonToForm(addon: ServiceAddonRow): FormState {
  return {
    id: addon.id,
    code: addon.code,
    name: addon.name,
    description: addon.description,
    category: addon.category,
    defaultAmount:
      addon.default_amount !== null ? String(addon.default_amount) : "",
    unit: addon.unit,
    createsDeviation: addon.creates_deviation,
    journeyTypes: addon.journey_types,
  };
}

export default function ServiceAddonsManager({
  addons,
  canEdit,
}: ServiceAddonsManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const openNew = () => {
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (addon: ServiceAddonRow) => {
    setForm(addonToForm(addon));
    setFormOpen(true);
  };

  const submitForm = () => {
    startTransition(async () => {
      const result = await upsertServiceAddonAction({
        id: form.id,
        code: form.code,
        name: form.name,
        description: form.description,
        category: form.category,
        defaultAmount: form.defaultAmount ? Number(form.defaultAmount) : null,
        unit: form.unit,
        createsDeviation: form.createsDeviation,
        journeyTypes: form.journeyTypes,
      });

      if (!result.ok) {
        toast.add({
          title: "Could not save add-on",
          description: result.error,
        });
        return;
      }

      toast.add({
        title: form.id ? "Add-on updated" : "Add-on created",
        description: result.addon.name,
      });
      setFormOpen(false);
    });
  };

  const toggleActive = (addon: ServiceAddonRow) => {
    startTransition(async () => {
      const result = await toggleAddonActiveAction(addon.id, !addon.active);
      if (!result.ok) {
        toast.add({ title: "Could not update", description: result.error });
        return;
      }
      toast.add({
        title: addon.active ? "Add-on deactivated" : "Add-on activated",
        description: addon.name,
      });
    });
  };

  const confirmDelete = (id: string) => {
    startTransition(async () => {
      const result = await deleteServiceAddonAction(id);
      if (!result.ok) {
        toast.add({ title: "Could not delete", description: result.error });
        setDeletingId(null);
        return;
      }
      toast.add({ title: "Add-on deleted" });
      setDeletingId(null);
    });
  };

  const toggleJourneyType = (jt: string) => {
    setForm((prev) => ({
      ...prev,
      journeyTypes: prev.journeyTypes.includes(jt)
        ? prev.journeyTypes.filter((t) => t !== jt)
        : [...prev.journeyTypes, jt],
    }));
  };

  return (
    <>
      <div className="flex flex-col gap-6">
        <Card className="gap-4">
          <SectionHeading
            title="Service add-ons"
            description="Chargeable add-ons that can be attached to a traveller's package — Qurbani, wheelchair assistance, extra baggage, and more."
            act={
              canEdit ? (
                <Button variant="secondary" onClick={openNew}>
                  <Plus /> Add Service
                </Button>
              ) : undefined
            }
          />

          {addons.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No service add-ons configured. Add one to get started.
            </p>
          ) : (
            <div className="overflow-x-auto no-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-none!">
                    {[
                      "Code",
                      "Name",
                      "Category",
                      "Default price",
                      "Unit",
                      "Journey types",
                      "Deviation",
                      "Status",
                      ...(canEdit ? [""] : []),
                    ].map((label) => (
                      <TableHead
                        key={label}
                        className="h-10 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap"
                      >
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border/20">
                  {addons.map((addon) => (
                    <TableRow
                      key={addon.id}
                      className={cn(
                        "hover:bg-muted/50",
                        !addon.active && "opacity-50",
                      )}
                    >
                      <TableCell className="px-3 py-2.5 text-xs font-number text-foreground">
                        {addon.code}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-sm text-foreground">
                        {addon.name}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                        {CATEGORIES.find((c) => c.value === addon.category)
                          ?.label ?? addon.category}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-sm font-number text-foreground">
                        {addon.default_amount !== null
                          ? `${addon.currency} ${Number(addon.default_amount).toLocaleString()}`
                          : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                        {UNITS.find((u) => u.value === addon.unit)?.label ??
                          addon.unit}
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <div className="flex gap-1">
                          {addon.journey_types.map((jt) => (
                            <Badge
                              key={jt}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {jt}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                        {addon.creates_deviation ? "Yes" : "No"}
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <Badge
                          className={cn(
                            "text-[10px]",
                            addon.active ? TONE_CLASS.success : TONE_CLASS.neutral,
                          )}
                        >
                          {addon.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      {canEdit && (
                        <TableCell className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="xs"
                              title="Edit"
                              onClick={() => openEdit(addon)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              title={addon.active ? "Deactivate" : "Activate"}
                              disabled={isPending}
                              onClick={() => toggleActive(addon)}
                            >
                              <Power className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              title="Delete"
                              disabled={isPending}
                              onClick={() => setDeletingId(addon.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      {/* Add/Edit dialog */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => !open && setFormOpen(false)}
      >
        <DialogContent className="max-w-lg!">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit" : "New"} service add-on</DialogTitle>
            <DialogDescription>
              {form.id
                ? "Update this add-on's details."
                : "Create a new chargeable service that travellers can add to their package."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Code</label>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, code: e.target.value }))
                  }
                  placeholder="QURBANI"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Name</label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Qurbani / Hadi"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                Description
              </label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Optional description shown to staff"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">
                  Category
                </label>
                <Select
                  value={form.category}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, category: value ?? "" }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Unit</label>
                <Select
                  value={form.unit}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, unit: value ?? "" }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                Default price (LKR)
              </label>
              <Input
                type="number"
                value={form.defaultAmount}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    defaultAmount: e.target.value,
                  }))
                }
                placeholder="Leave empty if price varies"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground">
                Journey types
              </label>
              <div className="flex gap-2">
                {JOURNEY_TYPES.map((jt) => (
                  <button
                    key={jt.value}
                    type="button"
                    onClick={() => toggleJourneyType(jt.value)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs transition-colors",
                      form.journeyTypes.includes(jt.value)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/50 hover:bg-muted/50 text-foreground",
                    )}
                  >
                    {jt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={form.createsDeviation}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    createsDeviation: e.target.checked,
                  }))
                }
                className="rounded"
              />
              Creates a deviation (needs operational arrangement)
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submitForm}
                disabled={
                  isPending ||
                  !form.code.trim() ||
                  !form.name.trim() ||
                  form.journeyTypes.length === 0
                }
              >
                {isPending && <Loader2 className="animate-spin" />}
                {form.id ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deletingId !== null}
        onOpenChange={(open) => !open && setDeletingId(null)}
      >
        <DialogContent className="max-w-sm!">
          <DialogHeader>
            <DialogTitle>Delete add-on</DialogTitle>
            <DialogDescription>
              This will permanently remove this service add-on. If it is
              referenced by existing charges, deactivate it instead.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeletingId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={isPending}
              onClick={() => deletingId && confirmDelete(deletingId)}
            >
              {isPending && <Loader2 className="animate-spin" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
