"use client";

import { Loader2, Upload } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState, useTransition } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { createDocumentUploadUrl } from "@/app/(main)/departure-groups/document-storage";
import { recordIssueAction } from "../actions";
import type { VisaListItem } from "../types";
import { VISA_EVIDENCE_SOURCE_LABELS } from "@/lib/access/visa-access";

interface RecordIssueDialogProps {
  item: VisaListItem | null;
  open: boolean;
  onClose: () => void;
}

/** Records an issued visa's details. Recording is not verifying — the drawer
 *  shows a separate "Mark Issued & Verified" action once evidence is on file. */
const RecordIssueDialog = ({ item, open, onClose }: RecordIssueDialogProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [visaId, setVisaId] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [entryType, setEntryType] = useState<"" | "SINGLE" | "MULTIPLE">("");
  const [evidenceSource, setEvidenceSource] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const isAmend = item?.visaId != null;

  useResetOnOpen(open, item?.journeyId ?? "", () => {
    setVisaId(item?.visaId ?? "");
    setIssueDate(item?.issueDate ?? "");
    setExpiryDate(item?.expiryDate ?? "");
    setValidUntil(item?.validUntil ?? "");
    setEntryType((item?.entryType as "SINGLE" | "MULTIPLE" | null) ?? "");
    setEvidenceSource(item?.evidenceSource ?? "");
    setIssueNote(item?.issueNote ?? "");
    setFilePath(item?.filePath ?? null);
    setFileName(null);
  });

  const upload = (file: File) => {
    if (!item) return;
    setUploading(true);
    startTransition(async () => {
      const signed = await createDocumentUploadUrl({
        departureGroupId: item.groupId,
        pilgrimId: item.journeyId,
        documentId: "visa-copy",
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!signed.ok) {
        toast.add({ title: "Upload refused", description: signed.error });
        setUploading(false);
        return;
      }
      const endpoint = `/storage/v1/object/upload/sign/pilgrim-documents/${signed.path}?token=${encodeURIComponent(signed.token)}`;
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${endpoint}`, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      setUploading(false);
      if (!response.ok) {
        toast.add({ title: "Upload failed", description: "The file could not be stored. Try again." });
        return;
      }
      setFilePath(signed.path);
      setFileName(signed.fileName);
      toast.add({ title: "Visa copy uploaded" });
    });
  };

  const submit = () => {
    if (!item || !visaId.trim()) return;
    startTransition(async () => {
      const result = await recordIssueAction({
        id: item.journeyId,
        departureGroupId: item.groupId,
        visaId: visaId.trim(),
        issueDate: issueDate || null,
        expiryDate: expiryDate || null,
        validUntil: validUntil || null,
        entryType: entryType || null,
        evidenceSource: evidenceSource || null,
        filePath,
        issueNote: issueNote.trim() || null,
      });
      if (!result.ok) {
        toast.add({ title: "Could not record", description: result.error });
        return;
      }
      toast.add({ title: isAmend ? "Visa details amended" : "Visa recorded", description: "Verification is a separate step." });
      router.refresh();
      onClose();
    });
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg gap-4">
        <DialogHeader>
          <DialogTitle>{isAmend ? "Amend issued visa" : "Record issued visa"}</DialogTitle>
          <DialogDescription>
            {item.fullName} · {item.groupName}. Recording does not claim validity — verify separately once evidence is on
            file.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-xs font-medium text-foreground">Visa Number *</label>
            <Input value={visaId} onChange={(e) => setVisaId(e.target.value)} placeholder="e.g. UM-2026-38219" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-foreground">Issue Date</label>
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-foreground">Expiry Date</label>
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-foreground">Entry Type</label>
            <Select
              value={entryType}
              onValueChange={(value) =>
                setEntryType(value as "SINGLE" | "MULTIPLE" | "")
              }
            >
              <SelectTrigger className="w-full text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SINGLE" className="text-xs">
                  Single Entry
                </SelectItem>
                <SelectItem value="MULTIPLE" className="text-xs">
                  Multiple Entry
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-foreground">Valid Until</label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-xs font-medium text-foreground">Evidence Source</label>
            <Select value={evidenceSource} onValueChange={(value) => setEvidenceSource(value as string)}>
              <SelectTrigger className="w-full text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(VISA_EVIDENCE_SOURCE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 cursor-pointer hover:bg-muted/40">
          {uploading ? <Loader2 className="animate-spin" /> : <Upload className="size-4" />}
          <span className="text-sm text-muted-foreground">
            {uploading ? "Uploading…" : fileName ? `Uploaded: ${fileName}` : filePath ? "Visa copy on file — replace" : "Upload Visa Copy"}
          </span>
          <input
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) upload(file);
            }}
          />
        </label>

        <Textarea value={issueNote} onChange={(e) => setIssueNote(e.target.value)} rows={2} placeholder="Internal note (optional)" />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending || uploading || !visaId.trim()}>
            {isPending && <Loader2 className="animate-spin" />} {isAmend ? "Save Amendment" : "Record Visa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RecordIssueDialog;
