"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { emailSchema } from "@/lib/validations/auth";
import { Loader2Icon } from "lucide-react";
import React, { useState, useTransition } from "react";
import { z } from "zod";
import { sendPasswordResetAction } from "../../actions";

interface ForgotPasswordDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  defaultEmail?: string;
}

const ForgotPasswordDialog = ({
  open,
  setOpen,
  defaultEmail = "",
}: ForgotPasswordDialogProps) => {
  // The parent remounts this dialog every time it opens, so the initial values
  // below are all the resetting this form needs.
  const [email, setEmail] = useState(defaultEmail);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldError(null);
    setFormError(null);

    const parsed = emailSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(z.flattenError(parsed.error).fieldErrors.email?.[0] ?? null);
      return;
    }

    startTransition(async () => {
      const result = await sendPasswordResetAction(parsed.data);

      if (result.status === "success") {
        setSentTo(parsed.data.email);
        return;
      }

      setFieldError(result.errors?.email?.[0] ?? null);
      setFormError(result.message ?? null);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className={"text-center gap-0"}>
        {sentTo ? (
          <>
            <h2 className="text-3xl tracking-tighter font-medium">
              Check your inbox
            </h2>
            <p className="mt-2">
              If an account exists for
              <br />
              <span className="text-primary">{sentTo}</span>
              <br />
              we&apos;ve sent a link to reset your password.
            </p>
            <Button
              variant={"outline_without_border"}
              className={"mt-5"}
              onClick={() => setOpen(false)}
            >
              Back to sign in
            </Button>
          </>
        ) : (
          <>
            <h2 className="text-3xl tracking-tighter font-medium">
              Reset your password
            </h2>
            <p className="mt-2 text-muted-foreground">
              Enter your work email and we&apos;ll send you a secure link to set
              a new password.
            </p>

            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-3 mt-5 text-left"
            >
              <InputGroup>
                <InputGroupAddon align={"block-start"}>
                  <InputGroupText>Work email</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="reset-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={!!fieldError}
                  disabled={isPending}
                />
              </InputGroup>
              {fieldError && (
                <p className="text-xs text-destructive">{fieldError}</p>
              )}
              {formError && (
                <p className="text-xs text-destructive">{formError}</p>
              )}

              <Button
                type="submit"
                variant={"bg_primary_gradient"}
                className={"w-full mt-1"}
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <Loader2Icon className="animate-spin" />
                    Sending link
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ForgotPasswordDialog;
