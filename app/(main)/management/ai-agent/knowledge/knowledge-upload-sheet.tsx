"use client";

import { useRef, useState } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import {
  KNOWLEDGE_DOCUMENT_KINDS,
  KNOWLEDGE_DOCUMENT_KIND_LABELS,
  KNOWLEDGE_LANGUAGES,
  KNOWLEDGE_LANGUAGE_LABELS,
  KNOWLEDGE_MAX_FILE_BYTES,
  type KnowledgeDocumentKind,
  type KnowledgeLanguage,
} from "@/lib/validations/knowledge-base";
import { createClient } from "@/utils/supabase/client";

import { registerKnowledgeDocumentAction } from "./actions";

const KNOWLEDGE_BUCKET = "knowledge-base";

/** Browsers often leave a Markdown file's type empty, so fall back to the extension. */
function detectKnowledgeMimeType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "text/markdown";
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".pdf")) return "application/pdf";
  return "";
}

export function KnowledgeUploadSheet({ agencyId }: { agencyId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentKind, setDocumentKind] = useState<KnowledgeDocumentKind>("POLICY");
  const [language, setLanguage] = useState<KnowledgeLanguage>("en");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setFile(null);
    setTitle("");
    setDocumentKind("POLICY");
    setLanguage("en");
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChosen(chosen: File | null) {
    setFile(chosen);
    setErrorMessage(null);
    // Suggest a title from the file name, but never overwrite one the person typed.
    if (chosen && title.trim().length === 0) setTitle(chosen.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
  }

  async function submitDocument() {
    if (!file) {
      setErrorMessage("Choose a file to upload.");
      return;
    }
    if (file.size > KNOWLEDGE_MAX_FILE_BYTES) {
      setErrorMessage("This file is larger than 10 MB. Split it into smaller documents.");
      return;
    }
    const mimeType = detectKnowledgeMimeType(file);
    const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
    const storagePath = `${agencyId}/${crypto.randomUUID()}.${extension || "bin"}`;

    setSubmitting(true);
    setErrorMessage(null);

    const supabase = createClient();
    const uploaded = await supabase.storage.from(KNOWLEDGE_BUCKET).upload(storagePath, file, { contentType: mimeType, upsert: false });
    if (uploaded.error) {
      setSubmitting(false);
      setErrorMessage("We couldn't upload this file. Check your connection and try again.");
      return;
    }

    const result = await registerKnowledgeDocumentAction({
      title,
      documentKind,
      language,
      fileName: file.name,
      mimeType,
      byteSize: file.size,
      storagePath,
    });
    setSubmitting(false);

    if (!result.ok) {
      // The action removes the stored file itself for a duplicate or a failed save; if validation
      // rejected it before that, clean up here so no orphan is left in the bucket.
      await supabase.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]).catch(() => undefined);
      setErrorMessage(result.error);
      return;
    }

    toast.add({ title: "Document added", description: "The assistant is reading it now. This usually takes under a minute." });
    setOpen(false);
    resetForm();
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <SheetTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Add document
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-4 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add a document</SheetTitle>
          <SheetDescription>
            The assistant can answer questions from what is written here. It will never quote prices from a document — prices always
            come from your live departures.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>File (PDF, text or Markdown, up to 10 MB)</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
              onChange={(event) => handleFileChosen(event.target.files?.[0] ?? null)}
            />
          </InputGroup>

          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Title</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput value={title} maxLength={200} placeholder="For example, Cancellation and refund policy" onChange={(event) => setTitle(event.target.value)} />
          </InputGroup>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">What kind of document is it?</label>
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
            <label className="text-xs font-medium text-muted-foreground">Language the document is written in</label>
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
            {language !== "en" && (
              <p className="text-xs text-muted-foreground">
                Sinhala and Tamil documents are matched by exact words for now, so the assistant may miss questions phrased differently.
              </p>
            )}
          </div>

          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}
        </div>

        <SheetFooter>
          <Button onClick={submitDocument} disabled={submitting}>
            {submitting ? "Uploading…" : "Add document"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
