"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { sendPasswordResetAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { setupPasswordSchema } from "@/lib/validations/setup";

import { setAccountPasswordAction } from "../actions";

type FormMessage = { ok: boolean; text: string } | null;

/**
 * Step 1. Adds a password to the owner's account. It works only soon after the
 * email link was opened, so when that window has passed the form says why and
 * offers a fresh link instead of a dead end.
 */
export function AccountPasswordStep({ email, alreadySet }: { email: string; alreadySet: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<FormMessage>(null);
  const [needsFreshLink, setNeedsFreshLink] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const [isSendingLink, startSendingLink] = useTransition();

  if (alreadySet) {
    return <p className="text-sm text-foreground">Your password is set. You can also keep using secure email links.</p>;
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setNeedsFreshLink(false);

    const parsed = setupPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setMessage({ ok: false, text: parsed.error.issues[0]?.message ?? "Check your password." });
      return;
    }

    startSaving(async () => {
      const result = await setAccountPasswordAction(parsed.data);
      if (result.ok) {
        setMessage({ ok: true, text: result.message ?? "Your password is set." });
        setPassword("");
        setConfirmPassword("");
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.error });
        setNeedsFreshLink(Boolean(result.expiredLink));
      }
    });
  };

  const handleSendFreshLink = () => {
    startSendingLink(async () => {
      const result = await sendPasswordResetAction({ email });
      setMessage(
        result.status === "success"
          ? { ok: true, text: `We sent a fresh link to ${email}. Open it to choose your password.` }
          : { ok: false, text: result.message ?? "We couldn't send the link. Please try again." },
      );
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>New password</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters, with a letter and a number"
          autoComplete="new-password"
          required
        />
      </InputGroup>
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>Confirm password</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          required
        />
      </InputGroup>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isSaving || isSendingLink}>
          {isSaving && <Loader2Icon className="animate-spin" />} Set password
        </Button>
        {needsFreshLink && (
          <Button type="button" variant="outline" onClick={handleSendFreshLink} disabled={isSaving || isSendingLink}>
            {isSendingLink && <Loader2Icon className="animate-spin" />} Send me a fresh link
          </Button>
        )}
      </div>
    </form>
  );
}
