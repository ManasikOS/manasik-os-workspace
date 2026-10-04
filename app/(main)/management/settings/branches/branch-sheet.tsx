"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { CURRENCY_OPTIONS } from "@/lib/data/settings-copy";
import type { BranchDirectoryRow } from "@/lib/types/settings";

import { saveBranchAction } from "../actions";
import { Field } from "../components/field";
import { SelectDropdown } from "../components/select-dropdown";
import { InputGroupInput } from "@/components/ui/input-group";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

export function BranchSheet({
  branch,
  managers,
  open,
  onClose,
  onSaved,
}: {
  branch: BranchDirectoryRow | null;
  managers: { id: string; name: string }[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !branch;

  const [name, setName] = useState(branch?.name ?? "");
  const [code, setCode] = useState(branch?.code ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [email, setEmail] = useState(branch?.email ?? "");
  const [managerId, setManagerId] = useState(branch?.manager_id ?? "");
  const [defaultCurrency, setDefaultCurrency] = useState(
    branch?.default_currency ?? "LKR",
  );
  const [status, setStatus] = useState<string>(
    branch?.status === "ARCHIVED" ? "INACTIVE" : (branch?.status ?? "ACTIVE"),
  );
  const [isPrimary, setIsPrimary] = useState(branch?.is_primary ?? false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useResetOnOpen(open, branch?.id ?? "new", () => {
    setName(branch?.name ?? "");
    setCode(branch?.code ?? "");
    setAddress(branch?.address ?? "");
    setPhone(branch?.phone ?? "");
    setEmail(branch?.email ?? "");
    setManagerId(branch?.manager_id ?? "");
    setDefaultCurrency(branch?.default_currency ?? "LKR");
    setStatus(
      branch?.status === "ARCHIVED" ? "INACTIVE" : (branch?.status ?? "ACTIVE"),
    );
    setIsPrimary(branch?.is_primary ?? false);
    setError(null);
    setFieldErrors({});
  });

  const manager = managers.find((m) => m.id === managerId);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const result = await saveBranchAction({
      id: branch?.id,
      name,
      code,
      address,
      phone,
      email,
      managerId: managerId || undefined,
      managerName: manager?.name,
      defaultCurrency,
      status,
      isPrimary,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save the branch.");
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    toast.add({ title: isCreate ? "Branch added" : "Branch updated" });
    onSaved();
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="max-w-md gap-4 ">
        <SheetHeader>
          <SheetTitle>{isCreate ? "Add Branch" : "Edit Branch"}</SheetTitle>
          <SheetDescription>
            {isCreate ? "Add a new agency branch." : `Editing ${branch?.name}.`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 overflow-y-auto custom-scroll px-4">
          <Field label="Branch Name *" error={fieldErrors.name}>
            <InputGroupInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kandy Branch"
            />
          </Field>
          <Field
            label="Branch Code *"
            error={fieldErrors.code}
            hint="Letters, numbers and hyphens only."
          >
            <InputGroupInput
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="KDY"
            />
          </Field>
          <Field label="Branch Address">
            <InputGroupInput
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>
          <Field label="Branch Phone">
            <InputGroupInput
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label="Branch Email" error={fieldErrors.email}>
            <InputGroupInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <SelectDropdown
            value={managerId}
            label="Branch Manager"
            onChange={setManagerId}
            options={[
              { value: "", label: "Unassigned" },
              ...managers.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
          <SelectDropdown
            value={defaultCurrency}
            label="Default Currency"
            onChange={setDefaultCurrency}
            options={CURRENCY_OPTIONS}
          />
          <SelectDropdown
            value={status}
            label="Branch Status"
            onChange={setStatus}
            options={STATUS_OPTIONS}
          />
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <Checkbox
              checked={isPrimary}
              onCheckedChange={(c) => setIsPrimary(c === true)}
            />
            Primary branch
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !name.trim() || !code.trim()}
          >
            {submitting && <Loader2 className="animate-spin" />}{" "}
            {isCreate ? "Add Branch" : "Save Changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
