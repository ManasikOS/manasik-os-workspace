"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { templateChargeLabel } from "@/lib/inbox/template-charge-label";
import {
  countBodyVariables,
  renderTemplateText,
} from "@/lib/whatsapp/template-params";

import { sendConversationTemplateAction } from "../actions";
import type { InboxTemplate } from "../types";
import { useInboxRefresh } from "./inbox-refresh-context";

export function InboxConversationTemplatePicker({
  conversationId,
  templates,
}: {
  conversationId: string;
  templates: InboxTemplate[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [parameters, setParameters] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const refreshInbox = useInboxRefresh();
  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [selectedId, templates],
  );
  const parameterCount = selected ? countBodyVariables(selected.components) : 0;

  function chooseTemplate(template: InboxTemplate) {
    setSelectedId(template.id);
    setParameters(
      Array.from({ length: countBodyVariables(template.components) }, () => ""),
    );
    setError(null);
  }

  function sendSelectedTemplate() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await sendConversationTemplateAction({
        conversationId,
        templateId: selected.id,
        bodyParameters: parameters,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setSelectedId(null);
      setParameters([]);
      refreshInbox();
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline_without_border" className={"w-full"} />
        }
        disabled={templates.length === 0}
      >
        {templates.length === 0
          ? "No approved templates"
          : "Choose approved template"}
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Approved WhatsApp templates</SheetTitle>
          <SheetDescription>
            Choose a category, fill every variable, review the message and
            projected Meta charge, then send.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className="w-full rounded-md border p-3 text-left hover:border-primary/40"
              onClick={() => chooseTemplate(template)}
            >
              <span className="block text-sm font-medium">{template.name}</span>
              <span className="block text-xs text-muted-foreground">
                {template.category} · {template.language}
              </span>
              <span className="block text-xs text-muted-foreground">
                {templateChargeLabel(template)}
              </span>
            </button>
          ))}
        </div>
        {selected && (
          <div className="mt-6 space-y-3 border-t pt-4">
            <p className="text-sm font-medium">{selected.name}</p>
            {Array.from({ length: parameterCount }, (_, index) => (
              <InputGroup key={index}>
                <InputGroupAddon align="block-start">
                  Template value {index + 1}
                </InputGroupAddon>
                <InputGroupInput
                  value={parameters[index] ?? ""}
                  onChange={(event) =>
                    setParameters((current) =>
                      current.map((value, position) =>
                        position === index ? event.target.value : value,
                      ),
                    )
                  }
                  placeholder={`Value for {{${index + 1}}}`}
                />
              </InputGroup>
            ))}
            <div className="rounded-md bg-muted/50 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Preview
              </p>
              <p className="whitespace-pre-wrap text-sm">
                {renderTemplateText(selected.components, parameters)}
              </p>
              <p className="mt-2 text-xs font-medium">
                {templateChargeLabel(selected)}
              </p>
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              className="w-full"
              disabled={
                isPending ||
                parameters.length !== parameterCount ||
                parameters.some((value) => !value.trim())
              }
              onClick={sendSelectedTemplate}
            >
              {isPending ? "Sending…" : "Send approved template"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
