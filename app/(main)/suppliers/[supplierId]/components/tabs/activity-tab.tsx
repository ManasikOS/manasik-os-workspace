"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PersonChip } from "@/components/ui/tone-badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import React, { useState } from "react";

import { addSupplierNoteAction } from "../../../actions";
import type { SupplierCapabilities, SupplierProfile } from "../../../types";
import { ActorChip } from "@/components/ui/copilot-mark";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

interface ActivityTabProps {
  profile: SupplierProfile;
  can: SupplierCapabilities;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const ACTION_MESSAGES: Record<
  string,
  (e: {
    from_value: string | null;
    to_value: string | null;
    note: string | null;
  }) => string
> = {
  SUPPLIER_CREATED: (e) =>
    `Supplier added${e.to_value ? `: ${e.to_value}` : ""}.`,
  RELIABILITY_CHANGED: (e) =>
    `Reliability changed${e.from_value ? ` from ${e.from_value}` : ""} to ${e.to_value}.${e.note ? ` — ${e.note}` : ""}`,
  CONTACT_ADDED: (e) => `Contact added: ${e.to_value ?? ""}.`,
  CONTACT_UPDATED: (e) => `Contact updated: ${e.to_value ?? ""}.`,
  COMMITMENT_CREATED: (e) => `Commitment created: ${e.to_value ?? ""}.`,
  COMMITMENT_REQUESTED: () => "Commitment requested.",
  SUPPLIER_RESPONDED: () => "Supplier responded.",
  COMMITMENT_CONFIRMED: () => "Commitment confirmed.",
  COMMITMENT_COMPLETED: () => "Commitment marked completed.",
  COMMITMENT_CANCELLED: () => "Commitment cancelled.",
  COMMITMENT_DISPUTED: (e) =>
    `Commitment marked disputed.${e.note ? ` — ${e.note}` : ""}`,
  EVIDENCE_UPLOADED: () => "Evidence uploaded.",
  PAYMENT_RECORDED: (e) => `Payment recorded: ${e.to_value ?? ""}.`,
  PAYMENT_REFUNDED: (e) => `Refund recorded: ${e.to_value ?? ""}.${e.note ? ` — ${e.note}` : ""}`,
  NOTE_ADDED: (e) => e.note ?? "",
};

export default function ActivityTab({ profile, can }: ActivityTabProps) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const saveNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    const result = await addSupplierNoteAction({
      supplierId: profile.supplier.id,
      note,
    });
    setSaving(false);
    if (!result.ok) {
      toast.add({ title: "Could not save note", description: result.error });
      return;
    }
    toast.add({ title: "Note added" });
    setNote("");
  };

  return (
    <div className="flex flex-col gap-4">
      {can.editSupplier && (
        <div className="gap-3">
          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Add an internal note</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='"Good response time. Ask for Ramadan availability 60+ days early."'
            />
          </InputGroup>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={saveNote}
              disabled={saving || !note.trim()}
            >
              {saving ? "Saving…" : "Add Note"}
            </Button>
          </div>
        </div>
      )}

      {profile.activity.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Confirmations, notes, and payments will appear here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {profile.activity.map((event) => {
            const message =
              ACTION_MESSAGES[event.action]?.(event) ?? event.action;
            return (
              <div key={event.id} className="flex items-start gap-3">
                <ActorChip name={event.actor_name} />
                <div className="flex flex-col gap-0.5 flex-1">
                  <p className="text-sm text-foreground">{message}</p>
                  <span className="text-[11px] text-muted-foreground">
                    {relativeTime(event.created_at)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
