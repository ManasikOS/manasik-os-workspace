"use client";

import Image from "next/image";
import { ImageOff, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

import { createAgencyLogoUploadUrl } from "./logo-storage";

export function LogoUpload({
  logoUrl,
  onUploaded,
  canEdit,
}: {
  logoUrl: string | null;
  onUploaded: (path: string, signedUrl: string) => void;
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(logoUrl);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);

    const signed = await createAgencyLogoUploadUrl({ contentType: file.type, sizeBytes: file.size });
    if (!signed.ok) {
      setUploading(false);
      setError(signed.error);
      return;
    }

    const endpoint = `/storage/v1/object/upload/sign/agency-assets/${signed.path}?token=${encodeURIComponent(signed.token)}`;
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}${endpoint}`, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });

    setUploading(false);
    if (!response.ok) {
      setError("The logo could not be stored. Try again.");
      return;
    }

    setPreview(signed.signedUrl);
    onUploaded(signed.path, signed.signedUrl);
    toast.add({ title: "Logo uploaded", description: "Save Changes to apply it." });
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex size-16 items-center justify-center rounded-lg border border-border/40 bg-muted/30 overflow-hidden shrink-0">
        {preview ? (
          <Image src={preview} alt="Agency logo" width={64} height={64} className="object-contain size-full" />
        ) : (
          <ImageOff className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canEdit || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Upload className="size-3.5" />} Upload Logo
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
