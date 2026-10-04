"use client";

import { Loader2, Upload } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useMemo, useState, useTransition } from "react";

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
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { createDocumentUploadUrl } from "@/app/(main)/departure-groups/document-storage";
import { uploadDocumentOnBehalfAction } from "../actions";
import type { DocumentListItem } from "../types";

interface UploadDocumentDialogProps {
  documents: DocumentListItem[];
  open: boolean;
  onClose: () => void;
  preselected?: DocumentListItem | null;
}

/** Uploads straight to the private bucket with a one-shot signed URL, then
 *  records the resulting object path — reuses `document-storage.ts` verbatim. */
const UploadDocumentDialog = ({ documents, open, onClose, preselected }: UploadDocumentDialogProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<DocumentListItem | null>(preselected ?? null);

  useResetOnOpen(open, preselected?.documentId ?? "new", () => {
    setSearch("");
    setTarget(preselected ?? null);
  });

  const pool = useMemo(
    () => documents.filter((d) => d.status === "NOT_SUBMITTED" || d.status === "REJECTED"),
    [documents],
  );
  const filtered = useMemo(() => {
    if (!search.trim()) return pool.slice(0, 20);
    const q = search.trim().toLowerCase();
    return pool.filter((d) => d.fullName.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)).slice(0, 20);
  }, [pool, search]);

  const upload = (file: File) => {
    if (!target) return;
    startTransition(async () => {
      const signed = await createDocumentUploadUrl({
        departureGroupId: target.groupId,
        pilgrimId: target.journeyId,
        documentId: target.documentId,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!signed.ok) {
        toast.add({ title: "Upload refused", description: signed.error });
        return;
      }

      const endpoint = `/storage/v1/object/upload/sign/pilgrim-documents/${signed.path}?token=${encodeURIComponent(signed.token)}`;
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${endpoint}`, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        toast.add({ title: "Upload failed", description: "The file could not be stored. Try again." });
        return;
      }

      const recorded = await uploadDocumentOnBehalfAction({
        documentId: target.documentId,
        filePath: signed.path,
        fileName: signed.fileName,
        fileSizeBytes: file.size,
      });
      if (!recorded.ok) {
        toast.add({ title: "Could not record", description: recorded.error });
        return;
      }
      toast.add({ title: "Document received", description: `${target.name} — ${target.fullName}` });
      router.refresh();
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>Staff may upload on behalf of a pilgrim.</DialogDescription>
        </DialogHeader>

        {!target ? (
          <div className="flex flex-col gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search pilgrim or requirement…" />
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto custom-scroll">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No outstanding requirements match.</p>
              ) : (
                filtered.map((d) => (
                  <button
                    key={d.documentId}
                    type="button"
                    className="flex flex-col items-start rounded-sm px-2.5 py-2 text-left hover:bg-muted/50"
                    onClick={() => setTarget(d)}
                  >
                    <span className="text-sm text-foreground">{d.fullName}</span>
                    <span className="text-[11px] text-muted-foreground">{d.name} · {d.groupName}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-border/40 p-2.5">
              <p className="text-sm text-foreground">{target.fullName}</p>
              <p className="text-[11px] text-muted-foreground">{target.name} · {target.groupName}</p>
            </div>
            <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border p-6 cursor-pointer hover:bg-muted/40">
              {isPending ? <Loader2 className="animate-spin" /> : <Upload className="size-4" />}
              <span className="text-sm text-muted-foreground">{isPending ? "Uploading…" : "Choose a file"}</span>
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
            {!preselected && (
              <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
                Choose a different requirement
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UploadDocumentDialog;
