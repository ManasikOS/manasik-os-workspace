"use client";

import { Download, MessageSquareWarning, UserPlus, XCircle } from "lucide-react";
import React, { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

import { bulkNotRequiredAction, bulkRequestReworkAction, sendBulkReminderAction } from "../actions";
import { documentsToChecklistCsv, downloadTextFile, timestampedFilename } from "../csv";
import type { DocumentCapabilities, DocumentListItem } from "../types";
import AssignReviewerDialog from "./assign-reviewer-dialog";

interface BulkActionsBarProps {
  selected: DocumentListItem[];
  clear: () => void;
  can: DocumentCapabilities;
}

const BulkActionsBar = ({ selected, clear, can }: BulkActionsBarProps) => {
  const [isPending, startTransition] = useTransition();
  const [assignOpen, setAssignOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [reworkMessage, setReworkMessage] = useState("");
  const [notRequiredOpen, setNotRequiredOpen] = useState(false);
  const [notRequiredReason, setNotRequiredReason] = useState("");

  const ids = selected.map((s) => s.documentId);

  const remind = () => {
    startTransition(async () => {
      const result = await sendBulkReminderAction({ documentIds: ids });
      if (!result.ok) {
        toast.add({ title: "Could not send reminders", description: result.error });
        return;
      }
      toast.add({ title: `Reminder logged for ${ids.length} document(s)` });
      clear();
    });
  };

  const submitRework = () => {
    if (!reworkMessage.trim()) return;
    startTransition(async () => {
      const result = await bulkRequestReworkAction({ documentIds: ids, reasonCode: "OTHER", message: reworkMessage.trim() });
      if (!result.ok) {
        toast.add({ title: "Could not send back", description: result.error });
        return;
      }
      toast.add({ title: `${ids.length} document(s) sent back for rework` });
      setReworkOpen(false);
      setReworkMessage("");
      clear();
    });
  };

  const submitNotRequired = () => {
    if (!notRequiredReason.trim()) return;
    startTransition(async () => {
      const result = await bulkNotRequiredAction({ documentIds: ids, reason: notRequiredReason.trim() });
      if (!result.ok) {
        toast.add({ title: "Could not update", description: result.error });
        return;
      }
      toast.add({ title: `${ids.length} document(s) marked not required` });
      setNotRequiredOpen(false);
      setNotRequiredReason("");
      clear();
    });
  };

  const exportChecklist = () => {
    downloadTextFile(timestampedFilename("document-checklist"), documentsToChecklistCsv(selected));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {can.assignReviewer && (
        <Button variant="outline_without_border" size="sm" onClick={() => setAssignOpen(true)}>
          <UserPlus /> Assign Reviewer
        </Button>
      )}
      {can.sendReminders && (
        <Button variant="outline_without_border" size="sm" onClick={remind} disabled={isPending}>
          <MessageSquareWarning /> Send Reminder
        </Button>
      )}
      {can.requestRework && (
        <Button variant="outline_without_border" size="sm" onClick={() => setReworkOpen(true)}>
          <XCircle /> Request Rework
        </Button>
      )}
      {can.waiveRequirement && (
        <Button variant="ghost" size="sm" onClick={() => setNotRequiredOpen(true)}>
          Mark as Not Required
        </Button>
      )}
      {can.exportChecklist && (
        <Button variant="ghost" size="sm" onClick={exportChecklist}>
          <Download /> Export Checklist
        </Button>
      )}

      <AssignReviewerDialog documentIds={ids} itemsLabel={`${ids.length} document(s) selected`} open={assignOpen} onClose={() => setAssignOpen(false)} />

      <Dialog open={reworkOpen} onOpenChange={(next) => !next && setReworkOpen(false)}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Request rework — {ids.length} document(s)</DialogTitle>
            <DialogDescription>The same message is logged against every selected document.</DialogDescription>
          </DialogHeader>
          <Textarea value={reworkMessage} onChange={(e) => setReworkMessage(e.target.value)} rows={4} placeholder="Why are these being sent back?" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReworkOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitRework} disabled={isPending || !reworkMessage.trim()}>
              Send Back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={notRequiredOpen} onOpenChange={(next) => !next && setNotRequiredOpen(false)}>
        <DialogContent className="max-w-md gap-4">
          <DialogHeader>
            <DialogTitle>Mark {ids.length} document(s) as not required</DialogTitle>
          </DialogHeader>
          <Textarea value={notRequiredReason} onChange={(e) => setNotRequiredReason(e.target.value)} rows={3} placeholder="Why do these not apply?" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotRequiredOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitNotRequired} disabled={isPending || !notRequiredReason.trim()}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BulkActionsBar;
