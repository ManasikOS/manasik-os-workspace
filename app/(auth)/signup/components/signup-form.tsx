"use client";

import { Loader2Icon, MailCheck } from "lucide-react";
import { useActionState, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { idleAuthState, type AuthActionState } from "@/lib/validations/auth";

import { resendSignupLinkAction, signupAction } from "../../actions";

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(signupAction, idleAuthState);
  const [resendState, setResendState] = useState<AuthActionState>(idleAuthState);
  const [isResending, startResending] = useTransition();

  if (state.status === "success") {
    const sentTo = state.email ?? "";
    const handleResend = () => {
      startResending(async () => {
        setResendState(await resendSignupLinkAction({ email: sentTo }));
      });
    };

    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <MailCheck className="size-8 text-primary" />
        <p className="text-sm font-medium text-foreground">Check your inbox</p>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{state.email}</span>. Open it
          to finish setting up your agency&apos;s workspace. It can take a minute to arrive — check your spam folder too.
        </p>
        <Button type="button" variant="link" onClick={handleResend} disabled={isResending}>
          {isResending && <Loader2Icon className="animate-spin" />} Send the link again
        </Button>
        {resendState.status === "success" && <p className="text-xs text-muted-foreground">We sent a new link.</p>}
        {resendState.status === "error" && resendState.message && (
          <p className="text-xs text-destructive">{resendState.message}</p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Agency name</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput name="agencyName" placeholder="Al-Noor Travels" />
        </InputGroup>
        {state.errors?.agencyName && <p className="text-xs text-destructive">{state.errors.agencyName[0]}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Your full name</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput name="ownerFullName" placeholder="Fatima Rizwan" />
        </InputGroup>
        {state.errors?.ownerFullName && <p className="text-xs text-destructive">{state.errors.ownerFullName[0]}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Work email</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput name="email" type="email" placeholder="you@agency.com" />
        </InputGroup>
        {state.errors?.email && <p className="text-xs text-destructive">{state.errors.email[0]}</p>}
      </div>

      {state.status === "error" && state.message && <p className="text-xs text-destructive">{state.message}</p>}

      <Button type="submit" disabled={isPending} className="mt-1">
        {isPending && <Loader2Icon className="animate-spin" />} Create workspace
      </Button>
    </form>
  );
}
