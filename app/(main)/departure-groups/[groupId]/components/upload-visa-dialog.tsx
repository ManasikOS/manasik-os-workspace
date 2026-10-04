"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { uploadVisaSchema } from "@/lib/validations/departure-groups";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { Loader2, Paperclip, TriangleAlert, Upload } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useRef, useState, useTransition } from "react";

import { analysePilgrimVisaAction, uploadVisaAction } from "../../actions";
import { createPilgrimFileUploadUrl } from "../../document-storage";
import type { DepartureGroupManifestRow } from "../../types";

interface UploadVisaDialogProps {
  manifest: DepartureGroupManifestRow[];
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Records an issued visa for one pilgrim.
 *
 * Only pilgrims with a live application (submitted or under review) are
 * offered — a visa cannot be issued for someone who never applied, and the
 * server refuses that too, so the picker just saves the round trip.
 */
const UploadVisaDialog = ({
  manifest,
  departureGroupId,
  open,
  onClose,
}: UploadVisaDialogProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const eligible = manifest.filter(
    (row) =>
      row.visaStatus === "SUBMITTED" || row.visaStatus === "UNDER_REVIEW",
  );
  const [pilgrimId, setPilgrimId] = useState(eligible[0]?.id ?? "");
  const [visaId, setVisaId] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The dialog stays mounted between opens, so the form has to clear each time
  // it opens: a visa ID is issued to one named traveller, and carrying the last
  // one into the next open is how the wrong number lands on the wrong pilgrim.
  useResetOnOpen(open, "", () => {
    setPilgrimId(eligible[0]?.id ?? "");
    setVisaId("");
    setExpiryDate("");
    setIssueNote("");
    setFile(null);
    setError(null);
  });

  // Fall back to the first eligible traveller rather than stranding the picker:
  // the selected pilgrim leaves this list the moment their visa is recorded.
  const selected =
    eligible.find((row) => row.id === pilgrimId) ?? eligible[0] ?? null;

  const submit = () => {
    setError(null);

    if (!selected) {
      setError("Pick a pilgrim with a submitted application.");
      return;
    }

    startTransition(async () => {
      let filePath: string | null = null;
      if (file) {
        const signed = await createPilgrimFileUploadUrl({
          departureGroupId,
          pilgrimId: selected.id,
          kind: "visa",
          contentType: file.type,
          sizeBytes: file.size,
        });
        if (!signed.ok) {
          setError(signed.error);
          return;
        }
        const endpoint = `/storage/v1/object/upload/sign/pilgrim-documents/${signed.path}?token=${encodeURIComponent(signed.token)}`;
        const uploadResponse = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}${endpoint}`,
          { method: "PUT", headers: { "Content-Type": file.type }, body: file },
        );
        if (!uploadResponse.ok) {
          setError("The visa file could not be stored. Try again.");
          return;
        }
        filePath = signed.path;
      }

      const check = uploadVisaSchema.safeParse({
        id: selected.id,
        departureGroupId,
        visaId,
        filePath,
        expiryDate: expiryDate || null,
        issueNote: issueNote.trim() || null,
      });
      if (!check.success) {
        setError(check.error.issues[0]?.message ?? "That visa upload is invalid.");
        return;
      }

      const result = await uploadVisaAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: "Visa uploaded",
        description: `${result.fullName}'s visa marked issued.`,
      });
      onClose();
      router.refresh();

      if (filePath) {
        const review = await analysePilgrimVisaAction(departureGroupId, selected.id);
        if (!review.ok) {
          toast.add({
            title: "AI review unavailable",
            description: review.error ?? "The visa was saved without a review.",
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
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Upload Visa</DialogTitle>
          <DialogDescription>
            Marks a pilgrim&apos;s visa as issued and records the visa ID.
          </DialogDescription>
        </DialogHeader>

        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pilgrim currently has a submitted application awaiting a visa.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Pilgrim
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <InputGroup>
                    <InputGroupInput
                      readOnly
                      value={selected ? selected.fullName : "Select a pilgrim"}
                    />
                  </InputGroup>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-64">
                  {eligible.map((row) => (
                    <DropdownMenuItem
                      key={row.id}
                      onClick={() => setPilgrimId(row.id)}
                    >
                      {row.fullName} · {row.bookingReference}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <InputGroup>
              <InputGroupAddon align="block-start">
                <InputGroupText>
                  Visa ID <span className="text-destructive">*</span>
                </InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                value={visaId}
                onChange={(e) => setVisaId(e.target.value)}
                placeholder="V-2026-004821"
                autoFocus
              />
            </InputGroup>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Visa file (optional)
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-3.5" />
                {file ? file.name : "Attach a copy of the visa"}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Attaching a copy runs it through an AI review that checks the
                name, passport number and expiry against this pilgrim&apos;s
                record — assistive only, it never verifies the visa itself.
              </span>
            </div>

            {/* Checked against the group's return date: a visa that expires
                mid-journey is refused here rather than at the airport. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Visa expiry (optional)
              </span>
              <Input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Issue note (optional)
              </span>
              <Textarea
                value={issueNote}
                onChange={(e) => setIssueNote(e.target.value)}
                placeholder="Any note for the file — e.g. single-entry, valid through date."
                rows={3}
                className="text-xs"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {eligible.length > 0 && (
            <Button disabled={isPending} onClick={submit}>
              {isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              Upload Visa
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UploadVisaDialog;
