"use client";

import { useState } from "react";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import {
  KNOWLEDGE_ARTICLE_MAX_CHARS,
  KNOWLEDGE_DOCUMENT_KINDS,
  KNOWLEDGE_DOCUMENT_KIND_LABELS,
  KNOWLEDGE_LANGUAGES,
  KNOWLEDGE_LANGUAGE_LABELS,
  type KnowledgeDocumentKind,
  type KnowledgeLanguage,
} from "@/lib/validations/knowledge-base";

import { saveKnowledgeArticleAction } from "./actions";

export interface KnowledgeArticleDraft {
  documentId: string;
  title: string;
  documentKind: KnowledgeDocumentKind;
  language: KnowledgeLanguage;
  body: string;
}

/** Write a short policy directly, or edit one written earlier (pass `existing`). */
export function KnowledgeArticleSheet({ existing }: { existing?: KnowledgeArticleDraft }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [documentKind, setDocumentKind] = useState<KnowledgeDocumentKind>(existing?.documentKind ?? "POLICY");
  const [language, setLanguage] = useState<KnowledgeLanguage>(existing?.language ?? "en");
  const [body, setBody] = useState(existing?.body ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function resetToStart() {
    setTitle(existing?.title ?? "");
    setDocumentKind(existing?.documentKind ?? "POLICY");
    setLanguage(existing?.language ?? "en");
    setBody(existing?.body ?? "");
    setErrorMessage(null);
  }

  async function saveArticle() {
    setSaving(true);
    setErrorMessage(null);
    const result = await saveKnowledgeArticleAction({ documentId: existing?.documentId, title, documentKind, language, body });
    setSaving(false);

    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }
    toast.add({
      title: existing ? "Changes saved" : "Policy added",
      description: "The assistant is reading it now. This usually takes under a minute.",
    });
    setOpen(false);
    if (!existing) resetToStart();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetToStart();
      }}
    >
      <SheetTrigger render={<Button size="sm" variant={existing ? "ghost" : "outline"} />}>
        <PenLine className="size-4" />
        {existing ? "Edit" : "Write a policy"}
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{existing ? "Edit this policy" : "Write a policy"}</SheetTitle>
          <SheetDescription>
            Type a short policy or answer in your own words — no file needed. Keep it to one topic. Don&apos;t include prices: the
            assistant never quotes them from a document.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Title</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput value={title} maxLength={200} placeholder="For example, Refund timing" onChange={(event) => setTitle(event.target.value)} />
          </InputGroup>

          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>What it says</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={body}
              maxLength={KNOWLEDGE_ARTICLE_MAX_CHARS}
              rows={10}
              placeholder="For example: Refunds are paid back to the original payment method within 14 days of a cancellation being confirmed."
              onChange={(event) => setBody(event.target.value)}
            />
          </InputGroup>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">What kind of policy is it?</label>
            <Select items={KNOWLEDGE_DOCUMENT_KIND_LABELS} value={documentKind} onValueChange={(value) => setDocumentKind(value as KnowledgeDocumentKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KNOWLEDGE_DOCUMENT_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {KNOWLEDGE_DOCUMENT_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Language it is written in</label>
            <Select items={KNOWLEDGE_LANGUAGE_LABELS} value={language} onValueChange={(value) => setLanguage(value as KnowledgeLanguage)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KNOWLEDGE_LANGUAGES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {KNOWLEDGE_LANGUAGE_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}
        </div>

        <SheetFooter>
          <Button onClick={saveArticle} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Add policy"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
