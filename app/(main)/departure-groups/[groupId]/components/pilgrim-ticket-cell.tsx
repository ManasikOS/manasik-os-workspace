"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { AlertTriangle, Eye, Loader2, Upload } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useRef, useState, useTransition } from "react";

import {
  analysePilgrimTicketAction,
  uploadPilgrimTicketAction,
} from "../../actions";
import { createPilgrimFileUploadUrl, createDocumentDownloadUrl } from "../../document-storage";
import type { DepartureGroupManifestRow } from "../../types";
import { TONE_BADGE_BORDER, TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface PilgrimTicketCellProps {
  departureGroupId: string;
  row: DepartureGroupManifestRow;
  canManage: boolean;
}

/**
 * One pilgrim's own ticket file: upload it, view it, and see what the AI
 * review found — a name that doesn't match the passport on file, or flight
 * details that don't match the group's booked flight. Assistive only: the
 * review never blocks anything here, it just surfaces what a human should
 * double-check before this pilgrim boards.
 */
const PilgrimTicketCell = ({
  departureGroupId,
  row,
  canManage,
}: PilgrimTicketCellProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isReviewing, setIsReviewing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasTicket = !!row.ticketFilePath;
  const issues = row.ticketAiIssues ?? [];
  const criticalOrWarning = issues.filter(
    (i) => i.severity === "CRITICAL" || i.severity === "WARNING",
  );
  const pnrMismatch = issues.find((i) => i.code === "PNR_MISMATCH");
  // The extracted field's key is whatever the model or the free extractor
  // called it ("PNR", "Booking Reference", ...) — matched loosely rather than
  // by an exact key so it still shows up regardless of which path produced it.
  const extractedPnrKey = row.ticketAiExtracted
    ? Object.keys(row.ticketAiExtracted).find((key) => /pnr/i.test(key))
    : undefined;
  const extractedPnr = extractedPnrKey ? row.ticketAiExtracted?.[extractedPnrKey] : null;

  const upload = (file: File) => {
    startTransition(async () => {
      try {
        const signed = await createPilgrimFileUploadUrl({
          departureGroupId,
          pilgrimId: row.id,
          kind: "ticket",
          contentType: file.type,
          sizeBytes: file.size,
        });
        if (!signed.ok) {
          toast.add({ title: "Upload refused", description: signed.error });
          return;
        }

        const endpoint = `/storage/v1/object/upload/sign/pilgrim-documents/${signed.path}?token=${encodeURIComponent(signed.token)}`;
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}${endpoint}`,
          { method: "PUT", headers: { "Content-Type": file.type }, body: file },
        );
        if (!response.ok) {
          toast.add({
            title: "Upload failed",
            description: "The file could not be stored. Try again.",
          });
          return;
        }

        const recorded = await uploadPilgrimTicketAction({
          departureGroupId,
          pilgrimId: row.id,
          filePath: signed.path,
          fileName: signed.fileName,
        });
        if (!recorded.ok) {
          toast.add({ title: "Could not record", description: recorded.error });
          return;
        }

        toast.add({
          title: "Ticket uploaded",
          description: `Reviewing ${recorded.fullName}'s ticket…`,
        });
        router.refresh();

        setIsReviewing(true);
        const review = await analysePilgrimTicketAction(departureGroupId, row.id);
        setIsReviewing(false);
        if (!review.ok) {
          toast.add({
            title: "AI review unavailable",
            description: review.error ?? "The ticket was saved without a review.",
          });
        } else if (review.issues.length > 0) {
          toast.add({
            title: "AI review found something to check",
            description: review.issues[0].message,
          });
        } else {
          toast.add({ title: "AI review found no issues" });
        }
        router.refresh();
      } catch {
        toast.add({
          title: "Upload failed",
          description: "The file could not be stored. Try again.",
        });
      }
    });
  };

  const view = () => {
    if (!row.ticketFilePath) return;
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    startTransition(async () => {
      const link = await createDocumentDownloadUrl(row.ticketFilePath!);
      if (!link.ok) {
        tab?.close();
        toast.add({ title: "Could not open", description: link.error });
        return;
      }
      if (tab) tab.location.replace(link.url);
      else window.open(link.url, "_blank", "noopener,noreferrer");
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      {hasTicket && (
        <Button variant="ghost" size="xs" title="View ticket" onClick={view}>
          <Eye className="size-3.5" />
        </Button>
      )}
      {canManage && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) upload(file);
            }}
          />
          <Button
            variant="ghost"
            size="xs"
            title={hasTicket ? "Replace ticket" : "Upload ticket"}
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
          >
            {isPending && !isReviewing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
          </Button>
        </>
      )}
      {isReviewing && (
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" /> Reviewing…
        </span>
      )}
      {extractedPnr && (
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] font-number",
            pnrMismatch
              ? cn(TONE_BADGE_BORDER.warning, TONE_TEXT.warning)
              : "text-muted-foreground",
          )}
          title={
            pnrMismatch
              ? pnrMismatch.message
              : `PNR read off the uploaded ticket: ${extractedPnr}`
          }
        >
          {extractedPnr}
        </Badge>
      )}
      {row.ticketAiStatus === "COMPLETE" && criticalOrWarning.length > 0 && (
        <Badge
          className={cn(TONE_CLASS.warning, "text-[10px]")}
          title={criticalOrWarning.map((i) => i.message).join(" · ")}
        >
          <AlertTriangle className="size-3" /> {criticalOrWarning.length}
        </Badge>
      )}
      {row.ticketAiStatus === "COMPLETE" && criticalOrWarning.length === 0 && (
        <Badge className={cn(TONE_CLASS.success, "text-[10px]")}>
          AI clear
        </Badge>
      )}
      {row.ticketAiStatus === "FAILED" && (
        <span
          className="text-[10px] text-muted-foreground"
          title={row.ticketAiError ?? undefined}
        >
          Review failed
        </span>
      )}
    </div>
  );
};

export default PilgrimTicketCell;
