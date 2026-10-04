"use client";

import { Loader2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { REWORK_REASON_LABELS } from "@/lib/access/documents-access";
import { reworkMessageFor } from "@/lib/data/documents-copy";

import { requestReworkAction } from "../actions";
import type { DocumentListItem } from "../types";
import { whatsappLink } from "../utils";

interface RequestReworkDialogProps {
  item: DocumentListItem | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

const REASON_CODES = ["BLURRED", "EXPIRY_INSUFFICIENT", "MISSING_PAGE", "NAME_MISMATCH", "OTHER"] as const;

const RequestReworkDialog = ({ item, open, onClose, onDone }: RequestReworkDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [reasonCode, setReasonCode] = useState<(typeof REASON_CODES)[number]>("BLURRED");
  const [message, setMessage] = useState("");

  useResetOnOpen(open, item?.documentId ?? "", () => {
    setReasonCode("BLURRED");
    setMessage(item ? reworkMessageFor("BLURRED", item.name) : "");
  });

  const setReason = (code: (typeof REASON_CODES)[number]) => {
    setReasonCode(code);
    if (item) setMessage(reworkMessageFor(code, item.name));
  };

  const submit = (channel: "WHATSAPP" | "PORTAL" | "NONE") => {
    if (!item || !message.trim()) return;
    startTransition(async () => {
      const result = await requestReworkAction({
        documentId: item.documentId,
        reasonCode,
        message: message.trim(),
        channel,
      });
      if (!result.ok) {
        toast.add({ title: "Could not send", description: result.error });
        return;
      }
      if (channel === "WHATSAPP") {
        window.open(whatsappLink(item.whatsappNumber, message.trim()), "_blank");
      }
      toast.add({ title: "Sent back for rework", description: item.fullName });
      onDone();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg gap-4">
        <DialogHeader>
          <DialogTitle>Request rework — {item?.name}</DialogTitle>
          <DialogDescription>The pilgrim sees this reason, so name the actual problem.</DialogDescription>
        </DialogHeader>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline_without_border" className="justify-start">Reason: {REWORK_REASON_LABELS[reasonCode]}</Button>} />
          <DropdownMenuContent align="start">
            {REASON_CODES.map((code) => (
              <DropdownMenuItem key={code} onClick={() => setReason(code)}>
                {REWORK_REASON_LABELS[code]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Message preview…" />

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={isPending || !message.trim()} onClick={() => submit("PORTAL")}>
            {isPending && <Loader2 className="animate-spin" />} Save
          </Button>
          <Button disabled={isPending || !message.trim()} onClick={() => submit("WHATSAPP")}>
            {isPending && <Loader2 className="animate-spin" />} Send via WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestReworkDialog;
