"use client";

import { useCallback, useRef, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/utils/supabase/client";
import {
  STAFF_ATTACHMENT_ACCEPT,
  prepareStaffAttachmentSchema,
  type StagedAttachmentRef,
} from "@/lib/inbox/attachments/staff-attachment";
import { prepareStaffAttachmentUpload } from "../actions";
import { stageVaultDocumentForComposerAction } from "../vault-actions";
import { Add, Laptop2, Ssd } from "reicon-react";

const ATTACHMENT_BUCKET = "inbox-attachments";

export type ComposerAttachmentState =
  | { status: "none" }
  | { status: "uploading"; name: string; size: number }
  | { status: "ready"; name: string; size: number; ref: StagedAttachmentRef }
  | { status: "failed"; name: string; size: number; error: string };

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * One file staged for the next reply. The browser only uploads it: the server issued the path, and reads the stored file back and judges
 * it before anything is sent, so the checks here (type and size, for a quick and friendly refusal) are a convenience, never the guard.
 */
export function useComposerAttachment(conversationId: string) {
  const [state, setState] = useState<ComposerAttachmentState>({
    status: "none",
  });
  // A file chosen and then replaced or removed while its upload is still running must not come back when the upload ends.
  const currentUpload = useRef(0);

  const choose = useCallback(
    async (file: File) => {
      const upload = ++currentUpload.current;
      const early = prepareStaffAttachmentSchema.safeParse({
        conversationId,
        filename: file.name,
        mimeType: file.type,
        byteSize: file.size,
      });
      if (!early.success) {
        setState({
          status: "failed",
          name: file.name,
          size: file.size,
          error: early.error.issues[0]?.message ?? "This file can't be sent.",
        });
        return;
      }
      setState({ status: "uploading", name: file.name, size: file.size });
      try {
        const prepared = await prepareStaffAttachmentUpload({
          conversationId,
          filename: file.name,
          mimeType: file.type,
          byteSize: file.size,
        });
        if (upload !== currentUpload.current) return;
        if (!prepared.ok) {
          setState({
            status: "failed",
            name: file.name,
            size: file.size,
            error: prepared.error,
          });
          return;
        }
        const { error } = await createClient()
          .storage.from(ATTACHMENT_BUCKET)
          .uploadToSignedUrl(prepared.path, prepared.token, file, {
            contentType: file.type,
          });
        if (upload !== currentUpload.current) return;
        if (error) {
          setState({
            status: "failed",
            name: file.name,
            size: file.size,
            error: "The upload didn't finish. Try attaching the file again.",
          });
          return;
        }
        setState({
          status: "ready",
          name: prepared.filename,
          size: file.size,
          ref: {
            path: prepared.path,
            filename: prepared.filename,
            mimeType: file.type,
          },
        });
      } catch {
        if (upload !== currentUpload.current) return;
        setState({
          status: "failed",
          name: file.name,
          size: file.size,
          error: "The upload didn't finish. Try attaching the file again.",
        });
      }
    },
    [conversationId],
  );

  /**
   * A file already in the vault: the browser never uploads it again — the
   * server copies it into this conversation's outbound path and hands back
   * the same `StagedAttachmentRef` shape `choose()` produces, so it joins
   * the exact same "ready" state and send path as a device upload.
   */
  const chooseFromVault = useCallback(
    async (document: {
      id: string;
      fileName: string;
      fileSizeBytes: number;
    }) => {
      const upload = ++currentUpload.current;
      setState({
        status: "uploading",
        name: document.fileName,
        size: document.fileSizeBytes,
      });
      try {
        const staged = await stageVaultDocumentForComposerAction({
          conversationId,
          vaultDocumentId: document.id,
        });
        if (upload !== currentUpload.current) return;
        if (!staged.ok) {
          setState({
            status: "failed",
            name: document.fileName,
            size: document.fileSizeBytes,
            error: staged.error,
          });
          return;
        }
        setState({
          status: "ready",
          name: staged.fileName,
          size: staged.fileSizeBytes,
          ref: staged.ref,
        });
      } catch {
        if (upload !== currentUpload.current) return;
        setState({
          status: "failed",
          name: document.fileName,
          size: document.fileSizeBytes,
          error: "This file could not be attached. Try again.",
        });
      }
    },
    [conversationId],
  );

  const clear = useCallback(() => {
    currentUpload.current += 1;
    setState({ status: "none" });
  }, []);

  return { state, choose, chooseFromVault, clear };
}

/**
 * The paperclip, now a dropdown: "Choose from device" is the old single
 * click (opens the file picker); "Choose from vault" opens the Vault
 * dialog in picker mode. Either path ends at the same `onChoose`/
 * `onOpenVaultPicker` — the composer treats a vault pick and a device
 * upload identically once a file lands in its "ready" state.
 */
export function ComposerAttachButton({
  disabled,
  onChoose,
  onOpenVaultPicker,
}: {
  disabled: boolean;
  onChoose: (file: File) => void;
  onOpenVaultPicker: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        aria-label="Choose a file to attach"
        className="sr-only"
        tabIndex={-1}
        accept={STAFF_ATTACHMENT_ACCEPT}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again (after removing it) still fires.
          event.target.value = "";
          if (file) onChoose(file);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label="Attach a file"
              title="Attach a photo, PDF or Office file"
            >
              <Add className="size-6" aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuItem onClick={() => inputRef.current?.click()}>
            {" "}
            <Laptop2 size={10} />
            Choose from device
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenVaultPicker}>
            <Ssd size={10} /> Choose from vault
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** What is attached, whether it is ready, and a way to remove it. */
export function ComposerAttachmentChip({
  state,
  onRemove,
}: {
  state: ComposerAttachmentState;
  onRemove: () => void;
}) {
  if (state.status === "none") return null;
  const failed = state.status === "failed";
  return (
    <div
      role="status"
      className={`mx-2 mb-1 flex items-center gap-2 rounded-md border px-2 py-1 text-xs ${failed ? "border-destructive/40 text-destructive" : "bg-muted/40"}`}
    >
      {state.status === "uploading" ? (
        <Loader2
          className="size-3.5 shrink-0 animate-spin"
          aria-hidden="true"
        />
      ) : (
        <FileText className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {state.name}{" "}
        <span className="text-muted-foreground">
          ({formatFileSize(state.size)})
        </span>
        {state.status === "uploading" && (
          <span className="text-muted-foreground"> — attaching…</span>
        )}
        {failed && <span> — {state.error}</span>}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        aria-label={`Remove ${state.name}`}
      >
        <X className="size-3" aria-hidden="true" />
      </Button>
    </div>
  );
}
