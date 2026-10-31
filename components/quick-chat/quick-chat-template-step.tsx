"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { sendConversationTemplateAction, startWhatsAppChat } from "@/app/inbox/actions";
import { loadQuickChatTemplatesAction } from "@/app/inbox/quick-chat-actions";
import type { InboxTemplate } from "@/app/inbox/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { QuickChatTarget } from "@/lib/inbox/quick-chat/resolve-target";
import { templateSendRoute, templateValuesComplete } from "@/lib/inbox/quick-chat/template-step";
import { templateCategoryLabel, templateChargeLabel } from "@/lib/inbox/template-charge-label";
import { countBodyVariables, renderTemplateText } from "@/lib/whatsapp/template-params";

const REASON_COPY = {
  NEW_NUMBER: "This number has not written to you yet, so WhatsApp only allows an approved template as the first message.",
  WINDOW_CLOSED: "The 24-hour reply window has closed, so WhatsApp only allows an approved template.",
  CONVERSATION_CLOSED: "This conversation is closed. An approved template reopens it.",
} as const;

interface QuickChatTemplateStepProps {
  target: Extract<QuickChatTarget, { kind: "NEEDS_TEMPLATE" }>;
  digits: string;
  contactName: string;
  /** Called once the template has been accepted for sending, with the conversation it went into. */
  onTemplateSent: (conversationId: string) => void;
}

/** The template step: choose an approved template, fill its values, see the message and the charge, send. */
export function QuickChatTemplateStep({ target, digits, contactName, onTemplateSent }: QuickChatTemplateStepProps) {
  const [templates, setTemplates] = useState<InboxTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // One key per attempt: a repeat of the same send (double click, retry) carries the same key and is never sent, or billed, twice.
  const attemptKey = useRef(crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    void loadQuickChatTemplatesAction({ channel: "WHATSAPP", to: digits }).then((result) => {
      if (cancelled) return;
      if (result.ok) setTemplates(result.templates);
      else setLoadError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [digits]);

  const template = useMemo(() => templates?.find((item) => item.id === templateId) ?? null, [templates, templateId]);
  const variableCount = template ? countBodyVariables(template.components) : 0;

  function choose(id: string | null) {
    const next = templates?.find((item) => item.id === id) ?? null;
    attemptKey.current = crypto.randomUUID();
    setTemplateId(next?.id ?? "");
    setValues(Array.from({ length: next ? countBodyVariables(next.components) : 0 }, () => ""));
    setError(null);
  }

  async function send() {
    if (!template || sending) return;
    setSending(true);
    setError(null);
    const route = templateSendRoute(target);
    const result =
      route.kind === "IN_CONVERSATION"
        ? await sendConversationTemplateAction({
            conversationId: route.conversationId,
            templateId: template.id,
            bodyParameters: values,
            clientIdempotencyKey: attemptKey.current,
          }).then((outcome) => (outcome.ok ? ({ ok: true, conversationId: route.conversationId } as const) : outcome))
        : await startWhatsAppChat({
            phoneNumber: digits,
            contactName,
            templateId: template.id,
            bodyParameters: values,
            clientIdempotencyKey: attemptKey.current,
          });
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    attemptKey.current = crypto.randomUUID();
    onTemplateSent(result.conversationId);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-sm text-foreground">{REASON_COPY[target.reason]}</p>

      {templates === null && !loadError && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading approved templates…
        </p>
      )}
      {loadError && (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      )}
      {templates && templates.length === 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          No approved templates are available, so a message cannot be sent from here. Create or sync one under Settings, WhatsApp Templates.
        </p>
      )}

      {templates && templates.length > 0 && (
        <>
          <Select
            items={templates.map((item) => ({
              value: item.id,
              label: `${item.name} · ${item.language} · ${templateCategoryLabel(item.category)}`,
            }))}
            value={templateId}
            onValueChange={choose}
          >
            <SelectTrigger className="w-full" aria-label="Approved template">
              <SelectValue placeholder="Choose an approved template" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} · {item.language} · {templateCategoryLabel(item.category)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {Array.from({ length: variableCount }, (_, index) => (
            <Input
              key={index}
              value={values[index] ?? ""}
              onChange={(event) => setValues((current) => current.map((value, position) => (position === index ? event.target.value : value)))}
              placeholder={`Value for {{${index + 1}}}`}
              aria-label={`Template value ${index + 1}`}
            />
          ))}

          {template && (
            <div className="rounded-md bg-background p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Message preview</p>
              <p className="whitespace-pre-wrap text-sm">{renderTemplateText(template.components, values)}</p>
              <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                {templateCategoryLabel(template.category)} message. {templateChargeLabel(template)}. Meta bills this when it is sent.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button className="w-full" onClick={() => void send()} disabled={!template || sending || !templateValuesComplete(values, variableCount)}>
            {sending ? "Sending…" : "Send approved template"}
          </Button>
        </>
      )}
    </div>
  );
}
