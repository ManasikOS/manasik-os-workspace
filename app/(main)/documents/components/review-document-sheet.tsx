"use client";

import { AlertTriangle, ExternalLink, Loader2, ScanSearch } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import {
  createReviewDownloadUrlAction,
  getLatestAnalysisAction,
  getReviewHistoryAction,
  runAiScanAction,
  updateExpiryAction,
  verifyDocumentAction,
} from "../actions";
import type { DocumentAiAnalysisRow, DocumentCapabilities, DocumentListItem, DocumentReviewEventRow } from "../types";
import { AI_VERDICT_LABELS, AI_VERDICT_TONES, STAGE_LABELS, STATUS_LABELS, documentTypeLabel, formatDate, statusToneFor } from "../utils";
import { cn } from "@/lib/utils";
import { TONE_CLASS, TONE_TEXT } from "@/lib/ui/tone";
import RequestReworkDialog from "./request-rework-dialog";

import { displayActorName } from "@/lib/agent/identity";
interface ReviewDocumentSheetProps {
  item: DocumentListItem | null;
  open: boolean;
  onClose: () => void;
  can: DocumentCapabilities;
  aiConfigured: boolean;
  /** In "review & next" mode, advances to the next selected document. */
  onNext?: () => void;
}

const ReviewDocumentSheet = ({ item, open, onClose, can, aiConfigured, onNext }: ReviewDocumentSheetProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [analysis, setAnalysis] = useState<DocumentAiAnalysisRow | null>(null);
  const [history, setHistory] = useState<DocumentReviewEventRow[]>([]);
  const [loadingSide, setLoadingSide] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [reworkOpen, setReworkOpen] = useState(false);
  const [expiryDraft, setExpiryDraft] = useState("");

  useResetOnOpen(open, item?.documentId ?? "", () => {
    setOverrideReason("");
    setReworkOpen(false);
    setExpiryDraft(item?.expiresAt ?? "");
    setAnalysis(null);
    setHistory([]);
    setLoadingSide(true);
  });

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    Promise.all([getLatestAnalysisAction(item.documentId), getReviewHistoryAction(item.documentId)]).then(([a, h]) => {
      if (cancelled) return;
      setAnalysis(a);
      setHistory(h);
      setLoadingSide(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, item]);

  const openFile = () => {
    if (!item?.filePath) return;
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    startTransition(async () => {
      const link = await createReviewDownloadUrlAction(item.filePath!);
      if (!link.ok) {
        tab?.close();
        toast.add({ title: "Could not open", description: link.error });
        return;
      }
      if (tab) tab.location.replace(link.url);
      else window.open(link.url, "_blank", "noopener,noreferrer");
    });
  };

  const runScan = () => {
    if (!item) return;
    startTransition(async () => {
      const result = await runAiScanAction(item.documentId);
      if (!result.ok) {
        toast.add({ title: "Scan could not complete", description: result.error });
        return;
      }
      toast.add({ title: "AI scan complete" });
      const [a, h] = await Promise.all([getLatestAnalysisAction(item.documentId), getReviewHistoryAction(item.documentId)]);
      setAnalysis(a);
      setHistory(h);
    });
  };

  const verify = () => {
    if (!item) return;
    const isOverriding = item.aiVerdict === "WARNING" || item.aiVerdict === "BLOCKED";
    if (isOverriding && !overrideReason.trim()) {
      toast.add({ title: "Reason required", description: "Explain why you are verifying anyway." });
      return;
    }
    startTransition(async () => {
      const result = await verifyDocumentAction({ documentId: item.documentId, overrideReason: overrideReason.trim() || undefined });
      if (!result.ok) {
        toast.add({ title: "Could not verify", description: result.error });
        return;
      }
      toast.add({ title: "Document verified", description: item.fullName });
      if (onNext) onNext();
      else onClose();
    });
  };

  const saveExpiry = () => {
    if (!item) return;
    startTransition(async () => {
      const result = await updateExpiryAction({ documentId: item.documentId, expiresAt: expiryDraft || null });
      if (!result.ok) {
        toast.add({ title: "Could not save", description: result.error });
        return;
      }
      toast.add({ title: "Expiry saved" });
    });
  };

  const isOverriding = item && (item.aiVerdict === "WARNING" || item.aiVerdict === "BLOCKED") && item.status !== "VERIFIED";
  const mayVerify = can.verifyDocuments && item?.status === "SUBMITTED";

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent className="sm:max-w-4xl! w-full flex flex-col">
          <SheetHeader>
            <SheetTitle>Review Document</SheetTitle>
            <SheetDescription>
              {item?.fullName}
              {item && (
                <>
                  {" · "}
                  {item.groupName} · {item.daysToDeparture >= 0 ? `Departs in ${item.daysToDeparture} days` : "Departed"}
                </>
              )}
            </SheetDescription>
          </SheetHeader>

          {item && (
            <div className="flex-1 overflow-y-auto custom-scroll grid gap-5 lg:grid-cols-2 px-1">
              {/* LEFT: preview */}
              <div className="flex flex-col gap-3">
                <div className="rounded-md border border-border/50 bg-muted/20 aspect-3/4 flex items-center justify-center">
                  {item.filePath ? (
                    <EmptyState
                      title="Document on file"
                      description={item.fileName ?? undefined}
                      action={
                        can.viewDocumentFile ? (
                          <Button size="sm" variant="secondary" onClick={openFile} disabled={isPending}>
                            <ExternalLink /> Open document
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <EmptyState title="Nothing uploaded yet" description="No file has been received for this requirement." />
                  )}
                </div>
              </div>

              {/* RIGHT: details */}
              <div className="flex flex-col gap-4">
                <Card className="gap-2">
                  <p className="text-xs font-medium text-foreground">Requirement details</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span className="text-muted-foreground">Requirement</span>
                    <span className="text-foreground text-right">{item.name}</span>
                    <span className="text-muted-foreground">Type</span>
                    <span className="text-foreground text-right">{documentTypeLabel(item.documentType)}</span>
                    <span className="text-muted-foreground">Required stage</span>
                    <span className="text-foreground text-right">{STAGE_LABELS[item.requiredByStage] ?? item.requiredByStage}</span>
                    <span className="text-muted-foreground">Status</span>
                    <ToneBadge tone={statusToneFor(item)} label={STATUS_LABELS[item.status] ?? item.status} className="justify-self-end" />
                    <span className="text-muted-foreground">Due</span>
                    <span className="text-foreground text-right">{formatDate(item.dueAt)}</span>
                    <span className="text-muted-foreground">Visible in portal</span>
                    <span className="text-foreground text-right">{item.visibleInPortal ? "Yes" : "No"}</span>
                  </div>
                </Card>

                {can.verifyDocuments && (
                  <Card className="gap-2">
                    <p className="text-xs font-medium text-foreground">Expiry</p>
                    <div className="flex items-center gap-2">
                      <Input type="date" value={expiryDraft} onChange={(e) => setExpiryDraft(e.target.value)} className="max-w-40" />
                      <Button size="sm" variant="secondary" onClick={saveExpiry} disabled={isPending}>
                        Save
                      </Button>
                    </div>
                  </Card>
                )}

                <Card className="gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">Manasik Copilot — Document Review</p>
                    {can.runAiScan && item.filePath && (
                      <Button variant="ghost" size="xs" onClick={runScan} disabled={isPending || !aiConfigured}>
                        {isPending ? <Loader2 className="animate-spin" /> : <ScanSearch />} {analysis ? "Re-scan" : "Run scan"}
                      </Button>
                    )}
                  </div>
                  {loadingSide ? (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  ) : !analysis ? (
                    <EmptyState title="Not yet analysed" description={aiConfigured ? "Manasik Copilot has no findings for this file yet." : "Manasik Copilot is not configured for this environment."} />
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <ToneBadge tone={AI_VERDICT_TONES[analysis.verdict] ?? "neutral"} label={AI_VERDICT_LABELS[analysis.verdict] ?? analysis.verdict} />
                        {analysis.confidence !== null && (
                          <span className="text-[11px] text-muted-foreground">{analysis.confidence}% confidence</span>
                        )}
                      </div>
                      {analysis.detected_type && (
                        <p className="text-xs text-muted-foreground">
                          Classification: {documentTypeLabel(analysis.detected_type)}
                          {analysis.type_confidence !== null ? ` (${analysis.type_confidence}%)` : ""}
                        </p>
                      )}
                      {Object.keys(analysis.extracted).length > 0 && (
                        <div className="rounded-md border border-border/40 p-2 flex flex-col gap-1">
                          {Object.entries(analysis.extracted).map(([k, v]) => (
                            <div key={k} className="flex justify-between text-[11px]">
                              <span className="text-muted-foreground">{k}</span>
                              <span className="text-foreground">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {analysis.checks.length > 0 && (
                        <div className="flex flex-col gap-1">
                          {analysis.checks.map((c) => (
                            <p key={c.code} className="text-[11px]">
                              {c.outcome === "PASS" ? "✓" : c.outcome === "WARN" ? "⚠" : "✗"} {c.label}
                              {c.detail ? ` — ${c.detail}` : ""}
                            </p>
                          ))}
                        </div>
                      )}
                      {analysis.recommendation_reason && (
                        <p className="text-[11px] text-muted-foreground">
                          Recommendation: {analysis.recommended_action} — {analysis.recommendation_reason}
                        </p>
                      )}
                      {analysis.status === "FAILED" && analysis.error_message && (
                        <p className="text-[11px] text-destructive">{analysis.error_message}</p>
                      )}
                    </div>
                  )}
                </Card>

                {isOverriding && (
                  <div className={cn("flex items-start gap-2.5 rounded-md p-3", TONE_CLASS.warning)}>
                    <AlertTriangle className={cn("size-4 shrink-0 mt-0.5", TONE_TEXT.warning)} />
                    <div className="flex-1 flex flex-col gap-1.5">
                      <p className={cn("text-xs", TONE_TEXT.warning)}>
                        This document has an AI {item.aiVerdict === "BLOCKED" ? "block" : "warning"}. Verifying it requires a reason.
                      </p>
                      <Textarea
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        rows={2}
                        placeholder="Reason for override…"
                      />
                    </div>
                  </div>
                )}

                {history.length > 0 && (
                  <Card className="gap-2">
                    <p className="text-xs font-medium text-foreground">Document history</p>
                    <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto custom-scroll">
                      {history.map((e) => (
                        <p key={e.id} className="text-[11px] text-muted-foreground">
                          {displayActorName(e.actor_name)} · {e.action} · {new Date(e.created_at).toLocaleString()}
                          {e.note ? ` — ${e.note}` : ""}
                        </p>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            </div>
          )}

          {item && (
            <SheetFooter className="flex-row flex-wrap gap-2">
              {mayVerify && (
                <Button onClick={verify} disabled={isPending}>
                  {isPending && <Loader2 className="animate-spin" />} {isOverriding ? "Verify anyway" : "Verify Document"}
                </Button>
              )}
              {can.requestRework && item.status === "SUBMITTED" && (
                <Button variant="outline_without_border" onClick={() => setReworkOpen(true)}>
                  Request Better Copy
                </Button>
              )}
              {can.requestRework && item.status === "SUBMITTED" && (
                <Button variant="destructive" onClick={() => setReworkOpen(true)}>
                  Reject
                </Button>
              )}
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      <RequestReworkDialog
        item={item}
        open={reworkOpen}
        onClose={() => setReworkOpen(false)}
        onDone={() => {
          setReworkOpen(false);
          router.refresh();
        }}
      />
    </>
  );
};

export default ReviewDocumentSheet;
