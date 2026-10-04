"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Trash2, Upload } from "lucide-react";

import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesForVault } from "@/lib/access/vault-access";
import { STAFF_ATTACHMENT_ACCEPT } from "@/lib/inbox/attachments/staff-attachment";
import { SUGGESTED_VAULT_CATEGORIES } from "@/lib/types/vault";
import type { VaultDocumentRow } from "@/lib/types/vault";
import { normalizeVaultCategoryLabel } from "@/lib/validations/vault";
import { createClient } from "@/utils/supabase/client";

import {
  confirmVaultUploadAction,
  deleteVaultDocumentAction,
  getVaultDocumentDownloadUrlAction,
  listVaultDocumentsAction,
  requestVaultUploadUrlAction,
} from "@/app/vault/actions";

const VAULT_BUCKET = "content-vault";

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface VaultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only needed in "manage" mode, to gate the Upload/Delete controls — a picker never offers them regardless of role. */
  role?: StaffRole;
  /** Manage: browse, upload, delete. Picker: browse and pick one — closes on selection instead of offering delete. */
  mode: "manage" | "picker";
  onSelect?: (document: VaultDocumentRow) => void;
}

/**
 * One dialog for every stored document, organized into category tabs.
 * Upload once here, then reference the same file everywhere it's needed
 * (e.g. the Inbox composer's "Choose from vault") — never re-uploaded.
 */
export default function VaultDialog({ open, onOpenChange, role, mode, onSelect }: VaultDialogProps) {
  const canManage = mode === "manage" && Boolean(role) && capabilitiesForVault(role as StaffRole).manageVault;
  const [documents, setDocuments] = useState<VaultDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>(SUGGESTED_VAULT_CATEGORIES[0]);
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await listVaultDocumentsAction({});
    setLoading(false);
    if (!result.ok) {
      toast.add({ title: "Could not load the vault", description: result.error });
      return;
    }
    setDocuments(result.documents);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void refresh();
  }, [open, refresh]);

  const categories = useMemo(() => {
    const present = new Set(documents.map((d) => d.category));
    const ordered: string[] = [...SUGGESTED_VAULT_CATEGORIES];
    for (const category of present) {
      if (!ordered.includes(category)) ordered.push(category);
    }
    return ordered;
  }, [documents]);

  const itemsInTab = useMemo(
    () => documents.filter((d) => d.category === activeCategory),
    [documents, activeCategory],
  );

  const startUpload = useCallback(
    async (file: File) => {
      const category = activeCategory;
      setUploadingCategory(category);
      try {
        const prepared = await requestVaultUploadUrlAction({ category, filename: file.name, mimeType: file.type, byteSize: file.size });
        if (!prepared.ok) {
          toast.add({ title: "Could not start the upload", description: prepared.error });
          return;
        }
        const { error } = await createClient().storage.from(VAULT_BUCKET).uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
        if (error) {
          toast.add({ title: "The upload didn't finish", description: "Try attaching the file again." });
          return;
        }
        const confirmed = await confirmVaultUploadAction({
          category,
          title: prepared.filename,
          path: prepared.path,
          filename: prepared.filename,
          mimeType: file.type,
        });
        if (!confirmed.ok) {
          toast.add({ title: "Could not save to the vault", description: confirmed.error });
          return;
        }
        toast.add({ title: "Saved to the vault" });
        await refresh();
      } finally {
        setUploadingCategory(null);
      }
    },
    [activeCategory, refresh],
  );

  const handleDelete = useCallback(
    async (document: VaultDocumentRow) => {
      const result = await deleteVaultDocumentAction({ id: document.id });
      if (!result.ok) {
        toast.add({ title: "Could not delete", description: result.error });
        return;
      }
      setDocuments((current) => current.filter((d) => d.id !== document.id));
    },
    [],
  );

  const handleDownload = useCallback(async (document: VaultDocumentRow) => {
    const result = await getVaultDocumentDownloadUrlAction({ id: document.id });
    if (!result.ok) {
      toast.add({ title: "Could not open the file", description: result.error });
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl!">
        <DialogHeader>
          <DialogTitle>{mode === "picker" ? "Choose from vault" : "Document Vault"}</DialogTitle>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept={STAFF_ATTACHMENT_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void startUpload(file);
          }}
        />

        <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(normalizeVaultCategoryLabel(v))}>
          <TabsList>
            {categories.map((category) => (
              <TabsTrigger key={category} value={category}>
                {category}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {itemsInTab.length} {itemsInTab.length === 1 ? "document" : "documents"} in {activeCategory}
          </p>
          {canManage && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploadingCategory !== null}
              onClick={() => inputRef.current?.click()}
            >
              {uploadingCategory === activeCategory ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              Upload
            </Button>
          )}
        </div>

        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {loading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : itemsInTab.length === 0 ? (
            <EmptyState title={`No ${activeCategory.toLowerCase()} documents yet`} description={canManage ? "Upload the first one." : "Nothing stored here yet."} />
          ) : (
            itemsInTab.map((document) => (
              <div
                key={document.id}
                className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${mode === "picker" ? "cursor-pointer hover:bg-muted/40" : ""}`}
                onClick={mode === "picker" ? () => onSelect?.(document) : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">{document.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {document.file_name} · {formatFileSize(document.file_size_bytes)} · {document.uploaded_by_name}
                  </p>
                </div>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                  {mode === "picker" ? (
                    <Button type="button" size="sm" onClick={() => onSelect?.(document)}>
                      Select
                    </Button>
                  ) : (
                    <>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Download ${document.title}`} onClick={() => handleDownload(document)}>
                        <Download className="size-3.5" />
                      </Button>
                      {canManage && (
                        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Delete ${document.title}`} onClick={() => handleDelete(document)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
