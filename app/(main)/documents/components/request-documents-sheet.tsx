"use client";

import { MessageCircle, Search } from "lucide-react";
import React, { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";

import { sendBulkReminderAction } from "../actions";
import type { DocumentListItem } from "../types";
import { whatsappLink } from "../utils";

interface RequestDocumentsSheetProps {
  documents: DocumentListItem[];
  open: boolean;
  onClose: () => void;
}

/** Every missing required document across every active group, one WhatsApp
 *  reminder at a time — each message carries the pilgrim's own requirement. */
const RequestDocumentsSheet = ({ documents, open, onClose }: RequestDocumentsSheetProps) => {
  const [search, setSearch] = useState("");

  const missing = useMemo(() => {
    const base = documents.filter((d) => d.required && d.status === "NOT_SUBMITTED");
    if (!search.trim()) return base;
    const q = search.trim().toLowerCase();
    return base.filter((d) => d.fullName.toLowerCase().includes(q) || d.name.toLowerCase().includes(q));
  }, [documents, search]);

  const send = async (item: DocumentListItem) => {
    window.open(
      whatsappLink(item.whatsappNumber, `Assalamu Alaikum ${item.fullName}. Please upload your ${item.name} for ${item.groupName}.`),
      "_blank",
    );
    const result = await sendBulkReminderAction({ documentIds: [item.documentId] });
    if (result.ok) {
      toast.add({ title: "Reminder logged", description: item.fullName });
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="sm:max-w-lg!">
        <SheetHeader>
          <SheetTitle>Request Documents</SheetTitle>
          <SheetDescription>Every missing required document across active groups.</SheetDescription>
        </SheetHeader>

        <div className="px-1">
          <InputGroup className="w-full">
            <InputGroupAddon>
              <InputGroupText>
                <Search className="size-4 text-muted-foreground" />
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search pilgrim or requirement…" />
          </InputGroup>
        </div>

        <div className="flex-1 overflow-y-auto custom-scroll px-1 flex flex-col gap-1">
          {missing.length === 0 ? (
            <EmptyState title="Nothing missing" description="Every required document has been submitted." />
          ) : (
            missing.map((item) => (
              <div key={item.documentId} className="flex items-center justify-between gap-3 rounded-md px-2.5 py-2 hover:bg-muted/40">
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate">{item.fullName}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{item.name} · {item.groupName}</p>
                </div>
                <Button variant="outline_without_border" size="sm" onClick={() => send(item)}>
                  <MessageCircle /> Send
                </Button>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default RequestDocumentsSheet;
