"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";

import {
  loadEmailComposeMailboxReadinessAction,
  startEmailConversation,
} from "../actions";
import { parseAddressList } from "@/lib/inbox/email-message-metadata";

/** Unlike Messenger/Instagram, email lets staff start a brand-new conversation (docs/inbox/email-channel-implementation-plan.md, D3). */
export default function ComposeEmailDialog({
  collapsed = false,
  mailboxReady,
  onConversationCreated,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: {
  collapsed?: boolean;
  mailboxReady: boolean;
  onConversationCreated: (conversationId: string) => void;
  /** Lets a menu open the dialog; without it the dialog opens itself from its own button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** False when a menu owns the way in. */
  showTrigger?: boolean;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [isPending, startTransition] = useTransition();
  const [checkedMailboxReady, setCheckedMailboxReady] = useState<
    boolean | null
  >(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [ccInput, setCcInput] = useState("");
  const [bccInput, setBccInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refreshMailboxReadiness() {
    startTransition(async () => {
      try {
        setCheckedMailboxReady(await loadEmailComposeMailboxReadinessAction());
      } catch {
        setCheckedMailboxReady(false);
      }
    });
  }

  const isMailboxReady = checkedMailboxReady ?? mailboxReady;

  function reset() {
    setRecipientEmail("");
    setSubject("");
    setBody("");
    setShowCcBcc(false);
    setCcInput("");
    setBccInput("");
    setError(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await startEmailConversation({
        recipientEmail,
        subject,
        body,
        cc: parseAddressList(ccInput),
        bcc: parseAddressList(bccInput),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      reset();
      onConversationCreated(result.conversationId);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
          return;
        }
        refreshMailboxReadiness();
      }}
    >
      {showTrigger && (
        <DialogTrigger
          render={
            <Button
              className="mt-1"
              variant={"ghost"}
              size={collapsed ? "icon" : "default"}
              aria-label="Compose a new email"
            >
              {collapsed ? <Mail /> : "Compose email"}
            </Button>
          }
        />
      )}
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-4 sm:max-w-lg sm:p-6">
        <DialogHeader>
          <DialogTitle>Compose email</DialogTitle>
          <DialogDescription>
            {isMailboxReady
              ? "Starts a new conversation with this address using your agency’s connected mailbox."
              : "Connect a mailbox with IMAP enabled in Settings → Email before composing."}
          </DialogDescription>
        </DialogHeader>

        {!isMailboxReady ? (
          <div className="mt-5 grid gap-4">
            <Button render={<Link href="/management/settings/email" />}>
              Open email settings
            </Button>
          </div>
        ) : (
          <form className="mt-5 grid gap-4" onSubmit={submit}>
            <InputGroup>
              <InputGroupAddon align="block-start">
                Recipient email
              </InputGroupAddon>
              <InputGroupInput
                id="compose-email-recipient"
                type="email"
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.target.value)}
                placeholder="customer@example.com"
                autoComplete="email"
                aria-label="Recipient email"
                required
              />
            </InputGroup>

            {showCcBcc ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <InputGroup>
                  <InputGroupAddon align="block-start">Cc</InputGroupAddon>
                  <InputGroupInput
                    id="compose-email-cc"
                    value={ccInput}
                    onChange={(event) => setCcInput(event.target.value)}
                    placeholder="cc@example.com"
                    aria-label="Cc recipients"
                  />
                </InputGroup>
                <InputGroup>
                  <InputGroupAddon align="block-start">Bcc</InputGroupAddon>
                  <InputGroupInput
                    id="compose-email-bcc"
                    value={bccInput}
                    onChange={(event) => setBccInput(event.target.value)}
                    placeholder="bcc@example.com"
                    aria-label="Bcc recipients"
                  />
                </InputGroup>
              </div>
            ) : (
              <button
                type="button"
                className="-mt-2 self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setShowCcBcc(true)}
              >
                Add Cc/Bcc
              </button>
            )}

            <InputGroup>
              <InputGroupAddon align="block-start">Subject</InputGroupAddon>
              <InputGroupInput
                id="compose-email-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Your Umrah package enquiry"
                aria-label="Subject"
                required
              />
            </InputGroup>

            <InputGroup>
              <InputGroupAddon align="block-start">Message</InputGroupAddon>
              <InputGroupTextarea
                id="compose-email-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Write your message…"
                className="min-h-32"
                aria-label="Message"
                required
              />
            </InputGroup>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <DialogFooter className="-mx-4 -mb-4 mt-1 border-t p-4 sm:-mx-6 sm:-mb-6 sm:px-6">
              <Button
                type="button"
                variant="outline_without_border"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={
                  isPending ||
                  !recipientEmail.trim() ||
                  !subject.trim() ||
                  !body.trim()
                }
              >
                {isPending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
