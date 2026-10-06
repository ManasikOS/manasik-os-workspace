"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroupInput, InputGroupTextarea } from "@/components/ui/input-group";
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
import {
  STAFF_ROLES,
  ROLE_LABELS,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import {
  TEMPLATE_AUDIENCE_LABELS,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_CHANNEL_LABELS,
  TEMPLATE_VARIABLES,
} from "@/lib/data/settings-copy";
import type { MessageTemplateRow } from "@/lib/types/settings";

import { saveMessageTemplateAction } from "../actions";
import { Field } from "../components/field";
import { SelectDropdown } from "../components/select-dropdown";
import { TemplatePreview } from "./template-preview";

const CATEGORY_OPTIONS = Object.entries(TEMPLATE_CATEGORY_LABELS).map(
  ([value, label]) => ({ value, label }),
);
const CHANNEL_OPTIONS = Object.entries(TEMPLATE_CHANNEL_LABELS).map(
  ([value, label]) => ({ value, label }),
);
const AUDIENCE_OPTIONS = Object.entries(TEMPLATE_AUDIENCE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export function TemplateEditorSheet({
  template,
  open,
  onClose,
  onSaved,
  scopedRole,
  fixedChannel,
}: {
  template: MessageTemplateRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Marketing / Visa: assignedRoles is fixed to their own role and hidden from the form. */
  scopedRole: StaffRole | null;
  fixedChannel?: "EMAIL";
}) {
  const isCreate = !template;

  const [category, setCategory] = useState<string>(
    template?.category ?? "LEAD_RECEIVED",
  );
  const [name, setName] = useState(template?.name ?? "");
  const [channel, setChannel] = useState<string>(
    template?.channel ?? fixedChannel ?? "WHATSAPP",
  );
  const [audience, setAudience] = useState<string>(
    template?.audience ?? "LEAD",
  );
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [isActive, setIsActive] = useState(template?.is_active ?? true);
  const [assignedRoles, setAssignedRoles] = useState<StaffRole[]>(
    template?.assigned_roles ?? [],
  );
  const [showPreview, setShowPreview] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useResetOnOpen(open, template?.id ?? "new", () => {
    setCategory(template?.category ?? "LEAD_RECEIVED");
    setName(template?.name ?? "");
    setChannel(template?.channel ?? fixedChannel ?? "WHATSAPP");
    setAudience(template?.audience ?? "LEAD");
    setSubject(template?.subject ?? "");
    setBody(template?.body ?? "");
    setIsActive(template?.is_active ?? true);
    setAssignedRoles(
      template?.assigned_roles ?? (scopedRole ? [scopedRole] : []),
    );
    setShowPreview(false);
    setError(null);
    setFieldErrors({});
  });

  const toggleRole = (role: StaffRole) => {
    setAssignedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const insertVariable = (token: string) =>
    setBody((prev) => `${prev}{{${token}}}`);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const result = await saveMessageTemplateAction({
      id: template?.id,
      category,
      name,
      channel,
      audience,
      subject: channel === "EMAIL" ? subject : undefined,
      body,
      language: "en",
      isActive,
      assignedRoles: scopedRole ? [scopedRole] : assignedRoles,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save the template.");
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }

    toast.add({ title: isCreate ? "Template created" : "Template saved" });
    onSaved();
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="max-w-lg gap-4 overflow-y-auto custom-scroll">
        <SheetHeader>
          <SheetTitle>{isCreate ? "New Template" : "Edit Template"}</SheetTitle>
          <SheetDescription>
            Every outbound message goes through staff review before it sends —
            there is no autonomous send from this editor.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4">
          <Field label="Template Name">
            <InputGroupInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Booking Confirmation"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <SelectDropdown
                label="Category"
                value={category}
                onChange={setCategory}
                options={CATEGORY_OPTIONS}
                disabled={!isCreate}
              />
            </Field>
            <Field label="Channel">
              <SelectDropdown
                label="Channel"
                value={channel}
                onChange={setChannel}
                options={CHANNEL_OPTIONS}
                disabled={!isCreate || Boolean(fixedChannel)}
              />
            </Field>
          </div>

          <Field label="Audience">
            <SelectDropdown
              label="Audience"
              value={audience}
              onChange={setAudience}
              options={AUDIENCE_OPTIONS}
            />
          </Field>

          {channel === "EMAIL" && (
            <Field label="Subject">
              <InputGroupInput
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
          )}

          <Field label="Message Body" error={fieldErrors.body}>
            <InputGroupTextarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
            />
          </Field>

          <div>
            <span className="text-xs font-medium text-muted-foreground">
              Insert variable
            </span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {TEMPLATE_VARIABLES.map((token) => (
                <Button
                  key={token}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => insertVariable(token)}
                >
                  {`{{${token}}}`}
                </Button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowPreview((v) => !v)}
            className="self-start"
          >
            {showPreview ? "Hide preview" : "Preview with sample data"}
          </Button>
          {showPreview && <TemplatePreview body={body} />}

          {!scopedRole && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Assigned roles (blank = everyone)
              </span>
              <div className="flex flex-wrap gap-3 mt-2">
                {STAFF_ROLES.map((role) => (
                  <label
                    key={role}
                    className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
                  >
                    <Checkbox
                      checked={assignedRoles.includes(role)}
                      onCheckedChange={() => toggleRole(role)}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <Checkbox
              checked={isActive}
              onCheckedChange={(c) => setIsActive(c === true)}
            />
            Active
          </label>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !name.trim() || !body.trim()}
          >
            {submitting && <Loader2 className="animate-spin" />} Save Template
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
