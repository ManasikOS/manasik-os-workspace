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
import { toast } from "@/components/ui/toast";
import { UploadCloud } from "lucide-react";
import React, { useRef, useState } from "react";

import { attachCommitmentEvidenceAction } from "../../actions";
import { createSupplierEvidenceUploadUrl } from "../../supplier-storage";
import type { SupplierCommitmentRow } from "../../types";

interface UploadEvidenceDialogProps {
  supplierId: string;
  commitment: SupplierCommitmentRow | null;
  onClose: () => void;
}

export default function UploadEvidenceDialog({ supplierId, commitment, onClose }: UploadEvidenceDialogProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!commitment) return null;

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);

    const signed = await createSupplierEvidenceUploadUrl({
      supplierId,
      commitmentId: commitment.id,
      contentType: file.type,
      sizeBytes: file.size,
    });
    if (!signed.ok) {
      setUploading(false);
      setError(signed.error);
      return;
    }

    const endpoint = `/storage/v1/object/upload/sign/supplier-evidence/${signed.path}?token=${encodeURIComponent(signed.token)}`;
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${endpoint}`, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) {
      setUploading(false);
      setError("The file could not be stored. Try again.");
      return;
    }

    const recorded = await attachCommitmentEvidenceAction({ commitmentId: commitment.id, evidencePath: signed.path });
    setUploading(false);
    if (!recorded.ok) {
      setError(recorded.error ?? "Could not record the evidence.");
      return;
    }

    toast.add({ title: "Evidence uploaded", description: "The voucher or confirmation is now on file." });
    onClose();
  };

  return (
    <Dialog open={commitment !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <UploadCloud className="size-5 text-primary" />
            <DialogTitle>Upload Evidence</DialogTitle>
          </div>
          <DialogDescription>
            Upload the voucher, confirmation email, or supplier document for {commitment.service_label || "this commitment"}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : "Choose file (PDF, JPG, PNG, WEBP — max 10 MB)"}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={uploading}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
