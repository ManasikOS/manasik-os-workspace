"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MessageSquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  templateCategoryLabel,
  templateChargeLabel,
} from "@/lib/inbox/template-charge-label";
import {
  countBodyVariables,
  renderTemplateText,
} from "@/lib/whatsapp/template-params";

import { lookUpLeadForNumberAction, startWhatsAppChat } from "../actions";
import {
  dialableDigits,
  leadMatchMessage,
  type LeadMatchPreview,
} from "@/lib/inbox/new-chat-lead-match";
import type { InboxTemplate } from "../types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

export default function NewChatDialog({
  templates,
  collapsed = false,
  onConversationCreated,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: {
  templates: InboxTemplate[];
  collapsed?: boolean;
  onConversationCreated: (conversationId: string) => void;
  /** Lets a menu open the dialog; without it the dialog opens itself from its own button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** False when a menu owns the way in. */
  showTrigger?: boolean;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  // One key per attempt: a repeat of the same send (double click, retry) carries the same key and is never sent, or billed, twice.
  // Opening, closing or finishing starts a new attempt.
  const attemptKey = useRef(crypto.randomUUID());
  const setOpen = (next: boolean) => {
    attemptKey.current = crypto.randomUUID();
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [isPending, startTransition] = useTransition();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [parameters, setParameters] = useState<string[]>(() =>
    Array.from(
      {
        length: templates[0] ? countBodyVariables(templates[0].components) : 0,
      },
      () => "",
    ),
  );
  const [error, setError] = useState<string | null>(null);
  // The lead lookup answers for one number; an answer for an older number is never shown for the current one.
  const [leadLookup, setLeadLookup] = useState<{
    digits: string;
    matches: LeadMatchPreview[];
  } | null>(null);
  const typedDigits = dialableDigits(phoneNumber);

  useEffect(() => {
    if (!open || !typedDigits) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void lookUpLeadForNumberAction(typedDigits).then((result) => {
        if (!cancelled && result.ok)
          setLeadLookup({ digits: typedDigits, matches: result.matches });
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, typedDigits]);
  const leadMatch =
    typedDigits && leadLookup?.digits === typedDigits
      ? leadMatchMessage(leadLookup.matches)
      : null;

  const template = useMemo(
    () => templates.find((item) => item.id === templateId) ?? null,
    [templateId, templates],
  );
  const variableCount = template ? countBodyVariables(template.components) : 0;
  const preview = template
    ? renderTemplateText(template.components, parameters)
    : null;

  function selectTemplate(value: string | null) {
    const id = value ?? "";
    const selected = templates.find((item) => item.id === id);
    setTemplateId(id);
    setParameters(
      Array.from(
        { length: selected ? countBodyVariables(selected.components) : 0 },
        () => "",
      ),
    );
    setError(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await startWhatsAppChat({
        phoneNumber,
        contactName,
        templateId,
        bodyParameters: parameters,
        clientIdempotencyKey: attemptKey.current,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onConversationCreated(result.conversationId);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger && (
        <DialogTrigger
          render={
            <Button
              className="mt-2"
              variant={"secondary"}
              size={collapsed ? "icon" : "default"}
              aria-label="Start a new WhatsApp chat"
            >
              {collapsed ? <MessageSquarePlus /> : "New chat"}
            </Button>
          }
        />
      )}
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-4 sm:max-w-lg sm:p-6">
        <DialogHeader>
          <DialogTitle>Start a WhatsApp chat</DialogTitle>
          <DialogDescription>
            WhatsApp requires an approved template for the first message.
            Free-text replies become available after the customer responds.
          </DialogDescription>
        </DialogHeader>

        <form className="mt-5 grid gap-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>
                    WhatsApp number, with country code
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="new-chat-phone"
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  placeholder="94771234567"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-label="WhatsApp number"
                  required
                />
              </InputGroup>
              {leadMatch && (
                <p className="text-xs text-muted-foreground" role="status">
                  {leadMatch.text}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Contact name (optional)</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="new-chat-name"
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  placeholder="Optional"
                  autoComplete="name"
                  aria-label="Contact name"
                />
              </InputGroup>
            </div>
          </div>

          <div className="grid gap-1.5">
            {templates.length > 0 ? (
              <InputGroup>
                <InputGroupAddon align="block-start">
                  <InputGroupText>Approved template</InputGroupText>
                </InputGroupAddon>
                <Select
                  items={templates.map((item) => ({
                    value: item.id,
                    label: `${item.name} · ${item.language} · ${templateCategoryLabel(item.category)}`,
                  }))}
                  value={templateId}
                  onValueChange={selectTemplate}
                >
                  <SelectTrigger
                    id="new-chat-template"
                    className="w-full"
                    aria-label="Approved template"
                  >
                    <SelectValue placeholder="Choose a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} · {item.language} ·{" "}
                        {templateCategoryLabel(item.category)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InputGroup>
            ) : (
              <p
                className="rounded-sm border border-dashed p-3 text-sm text-muted-foreground"
                role="status"
              >
                No approved templates are available. Create or sync one under
                Settings → WhatsApp Templates.
              </p>
            )}
          </div>

          {Array.from({ length: variableCount }, (_, index) => (
            <InputGroup key={index}>
              <InputGroupAddon align="block-start">
                <InputGroupText>Template value {index + 1}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id={`new-chat-param-${index}`}
                value={parameters[index] ?? ""}
                onChange={(event) => {
                  const next = [...parameters];
                  next[index] = event.target.value;
                  setParameters(next);
                }}
                placeholder={`Value for {{${index + 1}}}`}
                aria-label={`Template value ${index + 1}`}
                required
              />
            </InputGroup>
          ))}

          {preview && (
            <div className="rounded-sm bg-muted/50 p-4">
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                Message preview
              </h3>
              <p className="whitespace-pre-wrap text-sm">{preview}</p>
              {template && (
                <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                  {templateCategoryLabel(template.category)} message.{" "}
                  {templateChargeLabel(template)}. Meta bills this when it is
                  sent.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="-mx-4 -mb-4 mt-1 border-t p-4 sm:-mx-6 sm:-mb-6 sm:px-6">
            <Button
              type="button"
              variant="outline_without_border"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={
                isPending ||
                !phoneNumber.trim() ||
                !templateId ||
                parameters.length !== variableCount ||
                parameters.some((value) => !value.trim())
              }
            >
              {isPending ? "Sending…" : "Send and open chat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
