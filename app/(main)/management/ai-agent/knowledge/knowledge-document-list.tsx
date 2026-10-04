"use client";

import { useEffect, useState, useTransition } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { FileText, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import type { Tone } from "@/lib/ui/tone";
import {
  KNOWLEDGE_DOCUMENT_KIND_LABELS,
  KNOWLEDGE_LANGUAGE_LABELS,
  type KnowledgeDocumentKind,
  type KnowledgeLanguage,
} from "@/lib/validations/knowledge-base";

import { KnowledgeArticleSheet } from "./knowledge-article-sheet";
import {
  deleteKnowledgeDocumentAction,
  reindexKnowledgeDocumentAction,
  setKnowledgeDocumentActiveAction,
  type KnowledgeActionResult,
} from "./actions";

export interface KnowledgeDocumentRow {
  id: string;
  title: string;
  document_kind: KnowledgeDocumentKind;
  language: KnowledgeLanguage;
  is_active: boolean;
  status: "UPLOADED" | "EXTRACTING" | "CHUNKING" | "EMBEDDING" | "READY" | "FAILED";
  status_detail: string | null;
  has_price_warning: boolean;
  chunk_count: number;
  uploaded_by_name: string | null;
  updated_at: string;
  source_kind: "UPLOAD" | "ARTICLE";
  /** The written text, only present for a policy typed into the app. */
  article_body: string | null;
}

const IN_PROGRESS_STATUSES = new Set(["UPLOADED", "EXTRACTING", "CHUNKING", "EMBEDDING"]);
const POLL_INTERVAL_MS = 4000;

function describeKnowledgeStatus(status: KnowledgeDocumentRow["status"]): { label: string; tone: Tone } {
  if (status === "READY") return { label: "Ready", tone: "success" };
  if (status === "FAILED") return { label: "Couldn't be used", tone: "danger" };
  if (status === "UPLOADED") return { label: "Waiting to start", tone: "neutral" };
  return { label: "Reading the document", tone: "info" };
}

function formatUpdatedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function KnowledgeDocumentList({ documents, canManage }: { documents: KnowledgeDocumentRow[]; canManage: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingDelete, setPendingDelete] = useState<KnowledgeDocumentRow | null>(null);

  const anyInProgress = documents.some((document) => IN_PROGRESS_STATUSES.has(document.status));

  // Documents move from "waiting" to "ready" in the background; refresh until none is still moving.
  useEffect(() => {
    if (!anyInProgress) return;
    const timer = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [anyInProgress, router]);

  function runDocumentAction(run: () => Promise<KnowledgeActionResult>, successTitle: string) {
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        toast.add({ title: "That didn't work", description: result.error });
        return;
      }
      toast.add({ title: successTitle });
      router.refresh();
    });
  }

  if (documents.length === 0) {
    return (
      <Card className="p-4">
        <EmptyState
          icon={<FileText className="size-8" />}
          title="No documents yet"
          description="Upload a file, or write a short policy directly — your cancellation rules, visa guide or frequently asked questions — so the assistant can answer without waiting for a colleague."
        />
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead>Assistant uses it</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((document) => {
              const status = describeKnowledgeStatus(document.status);
              return (
                <TableRow key={document.id}>
                  <TableCell className="min-w-56 max-w-sm whitespace-normal">
                    <p className="font-medium">{document.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {KNOWLEDGE_DOCUMENT_KIND_LABELS[document.document_kind]} · {KNOWLEDGE_LANGUAGE_LABELS[document.language]}
                    </p>
                    {document.status === "FAILED" && document.status_detail && (
                      <p className="mt-1 text-xs text-destructive">{document.status_detail}</p>
                    )}
                    {document.status === "READY" && document.has_price_warning && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        This document contains prices. The assistant will not quote them — it reads prices from your live departures.
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <ToneBadge tone={status.tone} label={status.label} />
                  </TableCell>
                  <TableCell className="max-w-36">
                    <p>{formatUpdatedDate(document.updated_at)}</p>
                    {document.uploaded_by_name && (
                      <p className="truncate text-xs text-muted-foreground" title={document.uploaded_by_name}>
                        by {document.uploaded_by_name}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={document.is_active}
                      disabled={!canManage || isPending || document.status !== "READY"}
                      aria-label={`${document.is_active ? "Stop" : "Start"} using ${document.title}`}
                      onCheckedChange={(checked: boolean) =>
                        runDocumentAction(
                          () => setKnowledgeDocumentActiveAction({ documentId: document.id, isActive: checked }),
                          checked ? "The assistant will use this document" : "The assistant will stop using this document",
                        )
                      }
                    />
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {document.source_kind === "ARTICLE" && document.article_body !== null && (
                          <KnowledgeArticleSheet
                            existing={{
                              documentId: document.id,
                              title: document.title,
                              documentKind: document.document_kind,
                              language: document.language,
                              body: document.article_body,
                            }}
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending || IN_PROGRESS_STATUSES.has(document.status)}
                          onClick={() =>
                            runDocumentAction(() => reindexKnowledgeDocumentAction({ documentId: document.id }), "Reading the document again")
                          }
                        >
                          <RefreshCw className="size-4" />
                          Read again
                        </Button>
                        <Button variant="ghost" size="sm" disabled={isPending} onClick={() => setPendingDelete(document)}>
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this document?</DialogTitle>
            <DialogDescription>
              “{pendingDelete?.title}” and the file behind it will be removed for good. The assistant will stop answering from it. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Keep document
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target) runDocumentAction(() => deleteKnowledgeDocumentAction({ documentId: target.id }), "Document deleted");
              }}
            >
              Delete document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
