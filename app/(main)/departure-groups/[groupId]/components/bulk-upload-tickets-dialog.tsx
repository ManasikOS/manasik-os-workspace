"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useRef, useState, useTransition } from "react";

import { matchAndFileTicketAction } from "../../actions";
import { createTicketStagingUploadUrl } from "../../document-storage";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";

interface BulkUploadTicketsDialogProps {
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

type FileState =
  | { status: "queued"; file: File }
  | { status: "uploading"; file: File }
  | { status: "matching"; file: File }
  | {
      status: "done";
      file: File;
      matched: { fullName: string; issueCount: number }[];
      unmatchedNames: string[];
    }
  | { status: "failed"; file: File; error: string };

/**
 * "Upload Tickets": drop a whole batch of e-tickets in at once — one file per
 * pilgrim, or an itinerary that names several — and each is read, matched to
 * a pilgrim on this group by the name it shows, filed, and reviewed, without
 * anyone picking which file belongs to whom. A name the model can't
 * confidently place is reported at the end rather than guessed at; use the
 * per-pilgrim "Upload Ticket" button on that row instead.
 */
const BulkUploadTicketsDialog = ({
  departureGroupId,
  open,
  onClose,
}: BulkUploadTicketsDialogProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [files, setFiles] = useState<FileState[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useResetOnOpen(open, "", () => {
    setFiles([]);
  });

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [
      ...prev,
      ...Array.from(list).map((file) => ({ status: "queued" as const, file })),
    ]);
  };

  const setFileState = (index: number, next: FileState) => {
    setFiles((prev) => prev.map((f, i) => (i === index ? next : f)));
  };

  const run = () => {
    startTransition(async () => {
      for (let i = 0; i < files.length; i++) {
        const entry = files[i];
        if (entry.status !== "queued" && entry.status !== "failed") continue;
        const file = entry.file;

        setFileState(i, { status: "uploading", file });
        try {
          const signed = await createTicketStagingUploadUrl({
            departureGroupId,
            contentType: file.type,
            sizeBytes: file.size,
          });
          if (!signed.ok) {
            setFileState(i, { status: "failed", file, error: signed.error });
            continue;
          }

          const endpoint = `/storage/v1/object/upload/sign/pilgrim-documents/${signed.path}?token=${encodeURIComponent(signed.token)}`;
          const uploadResponse = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}${endpoint}`,
            { method: "PUT", headers: { "Content-Type": file.type }, body: file },
          );
          if (!uploadResponse.ok) {
            setFileState(i, {
              status: "failed",
              file,
              error: "The file could not be stored.",
            });
            continue;
          }

          setFileState(i, { status: "matching", file });
          const result = await matchAndFileTicketAction(
            departureGroupId,
            signed.path,
            signed.fileName,
          );
          if (!result.ok) {
            setFileState(i, {
              status: "failed",
              file,
              error: result.error ?? "Could not match this ticket.",
            });
            continue;
          }

          setFileState(i, {
            status: "done",
            file,
            matched: result.matched.map((m) => ({
              fullName: m.fullName,
              issueCount: m.issues.length,
            })),
            unmatchedNames: result.unmatchedNames,
          });
        } catch {
          setFileState(i, {
            status: "failed",
            file,
            error: "Something interrupted this upload. Try again.",
          });
        }
      }

      router.refresh();
      const done = files.filter((f) => f.status === "done").length;
      toast.add({
        title: "Batch complete",
        description: `${done} of ${files.length} ticket file${files.length === 1 ? "" : "s"} filed.`,
      });
    });
  };

  const canRun = files.some((f) => f.status === "queued" || f.status === "failed");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isPending && onClose()}>
      <DialogContent className="max-w-lg!">
        <DialogHeader>
          <DialogTitle>Upload Tickets</DialogTitle>
          <DialogDescription>
            Drop in as many ticket files as you like. Each one is matched to a
            pilgrim on this group by the name printed on it, filed, and
            reviewed automatically — no need to pick who it belongs to.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="justify-start"
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-3.5" /> Choose ticket files…
          </Button>

          {files.length > 0 && (
            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto custom-scroll">
              {files.map((entry, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-1 rounded-sm border border-border/50 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-foreground truncate">
                      {entry.file.name}
                    </span>
                    {entry.status === "queued" && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        Queued
                      </span>
                    )}
                    {(entry.status === "uploading" || entry.status === "matching") && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                        <Loader2 className="size-3 animate-spin" />
                        {entry.status === "uploading" ? "Uploading…" : "Manasik Copilot is reading this ticket…"}
                      </span>
                    )}
                    {entry.status === "failed" && (
                      <span className="text-[10px] text-destructive flex items-center gap-1 shrink-0">
                        <TriangleAlert className="size-3" /> Failed
                      </span>
                    )}
                    {entry.status === "done" && entry.matched.length > 0 && (
                      <span className={`text-[10px] ${TONE_TEXT.success} flex items-center gap-1 shrink-0`}>
                        <CheckCircle2 className="size-3" /> Filed
                      </span>
                    )}
                  </div>

                  {entry.status === "failed" && (
                    <p className="text-[11px] text-destructive">{entry.error}</p>
                  )}

                  {entry.status === "done" && (
                    <div className="flex flex-col gap-1">
                      {entry.matched.map((m) => (
                        <div key={m.fullName} className="flex items-center gap-1.5">
                          <span className="text-[11px] text-foreground">
                            → {m.fullName}
                          </span>
                          {m.issueCount > 0 && (
                            <Badge className={`${TONE_CLASS.warning} text-[10px]`}>
                              <AlertTriangle className="size-2.5" /> {m.issueCount}
                            </Badge>
                          )}
                        </div>
                      ))}
                      {entry.unmatchedNames.length > 0 && (
                        <p className={`text-[11px] ${TONE_TEXT.warning}`}>
                          Couldn&apos;t place: {entry.unmatchedNames.join(", ")} — use
                          that pilgrim&apos;s own Upload Ticket button.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={isPending} onClick={onClose}>
            {isPending ? "Working…" : "Close"}
          </Button>
          {canRun && (
            <Button disabled={isPending} onClick={run}>
              {isPending && <Loader2 className="animate-spin" />}
              Upload &amp; Match {files.length} file{files.length === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkUploadTicketsDialog;
