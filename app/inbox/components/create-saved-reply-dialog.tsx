"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";

import { createSavedReplyAction } from "../actions";
import type { InboxSavedReply } from "../types";
import { Card } from "@/components/ui/card";

interface CreateSavedReplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (reply: InboxSavedReply) => void;
}

/** Opened from the composer's "Saved replies" dropdown — the only place in the app that writes a saved reply. */
export default function CreateSavedReplyDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateSavedReplyDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setBody("");
    setIsPrivate(false);
    setError(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await createSavedReplyAction({ title, body, isPrivate });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.reply);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Create saved reply</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>Title</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Payment reminder"
            />
          </InputGroup>
          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText>Reply text</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="What gets inserted into the draft…"
            />
          </InputGroup>
          <Card className="flex flex-row items-center justify-between rounded-md border px-3 py-2">
            <div>
              <p className="text-sm">Just for me</p>
              <p className="text-xs text-muted-foreground">
                Off shares it with the whole agency.
              </p>
            </div>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </Card>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline_without_border"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !title.trim() || !body.trim()}
          >
            {submitting ? "Saving…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
