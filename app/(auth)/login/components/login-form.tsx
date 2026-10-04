"use client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  emailSchema,
  idleAuthState,
  signInSchema,
  toFieldErrorState,
  type AuthActionState,
} from "@/lib/validations/auth";
import { Eye, EyeOff, Loader2Icon } from "lucide-react";
import Link from "next/link";
import React, { useActionState, useState, useTransition } from "react";
import { sendMagicLinkAction, signInAction } from "../../actions";
import ForgotPasswordDialog from "./forgot-password-dialog";
import ResetPasswordDialog from "./reset-password-dialog";
import SecureEmailDialog from "./secure-email-dialog";

interface LoginFormProps {
  /** True when a recovery link brought the user back to choose a password. */
  resetMode?: boolean;
  /** True when a Team invitation link brought a new user here to set their first password. */
  setupMode?: boolean;
  /** `link_expired` / `link_invalid`, set by the email callback routes. */
  notice?: string;
  /** Path the proxy wanted before it bounced the user to /login. */
  redirectTo?: string;
  /** True when this deployment lets agencies create their own workspace (SIGNUP_MODE=open). */
  signupOpen?: boolean;
}

const NOTICES: Record<string, string> = {
  link_expired: "That link has expired or was already used. Request a new one.",
  link_invalid: "That link was invalid. Request a new one.",
};

const LoginForm = ({
  resetMode = false,
  setupMode = false,
  notice,
  redirectTo,
  signupOpen = false,
}: LoginFormProps) => {
  const [showPassword, setShowPassword] = useState(false);

  const [secureDialogOpen, setSecureDialogOpen] = useState(false);
  const [forgotDialogOpen, setForgotDialogOpen] = useState(false);
  // Bumped on every open so the dialog remounts with a clean form.
  const [forgotDialogKey, setForgotDialogKey] = useState(0);
  const [resetDialogDismissed, setResetDialogDismissed] = useState(false);

  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(true);
  const [linkSentTo, setLinkSentTo] = useState("");
  const [magicState, setMagicState] = useState<AuthActionState>(idleAuthState);
  const [isSendingLink, startSendingLink] = useTransition();

  const openForgotDialog = () => {
    setForgotDialogKey((key) => key + 1);
    setForgotDialogOpen(true);
  };

  // Validated in the browser for instant feedback, then again inside the
  // Server Action, which is the check that actually protects the account.
  const [state, formAction, isSigningIn] = useActionState(
    async (prevState: AuthActionState, formData: FormData) => {
      formData.set("remember", String(remember));

      const parsed = signInSchema.safeParse({
        email: formData.get("email"),
        password: formData.get("password"),
        remember: formData.get("remember"),
      });

      if (!parsed.success) {
        return toFieldErrorState(parsed.error);
      }

      return signInAction(prevState, formData);
    },
    idleAuthState,
  );

  const handleMagicLink = () => {
    setMagicState(idleAuthState);

    const parsed = emailSchema.safeParse({ email });
    if (!parsed.success) {
      setMagicState(toFieldErrorState(parsed.error));
      return;
    }

    startSendingLink(async () => {
      const result = await sendMagicLinkAction(parsed.data);
      setMagicState(result);

      if (result.status === "success") {
        setLinkSentTo(result.email ?? parsed.data.email);
        setSecureDialogOpen(true);
      }
    });
  };

  const emailError = state.errors?.email?.[0] ?? magicState.errors?.email?.[0];
  const passwordError = state.errors?.password?.[0];
  const formError =
    state.status === "error"
      ? state.message
      : magicState.status === "error"
        ? magicState.message
        : null;
  const noticeMessage = notice ? NOTICES[notice] : null;
  const isBusy = isSigningIn || isSendingLink;

  return (
    <>
      <SecureEmailDialog
        open={secureDialogOpen}
        setOpen={setSecureDialogOpen}
        email={linkSentTo}
      />
      <ForgotPasswordDialog
        key={forgotDialogKey}
        open={forgotDialogOpen}
        setOpen={setForgotDialogOpen}
        defaultEmail={email}
      />
      <ResetPasswordDialog
        open={(resetMode || setupMode) && !resetDialogDismissed}
        setOpen={(open) => setResetDialogDismissed(!open)}
        mode={setupMode ? "setup" : "reset"}
      />
      <div className="w-full h-full items-center flex justify-center px-20">
        <Card className="py-5 px-5 text-center w-full gap-0 bg-card/40! backdrop-blur-lg">
          <h2 className="text-3xl font-semibold tracking-tight">
            Welcome back
          </h2>
          <p className="text-md mt-1">
            Sign in to access your agency workspace.
          </p>
          {noticeMessage && (
            <p className="text-xs text-destructive mt-3">{noticeMessage}</p>
          )}
          <form action={formAction} className="flex flex-col gap-3 mt-5">
            <input type="hidden" name="next" value={redirectTo ?? ""} />
            <InputGroup>
              <InputGroupAddon align={"block-start"}>
                <InputGroupText>Work email</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="email"
                aria-label="Work email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  // Drop a stale "secure link" error once the address changes.
                  if (magicState.status !== "idle") {
                    setMagicState(idleAuthState);
                  }
                }}
                aria-invalid={!!emailError}
              />
            </InputGroup>
            {emailError && (
              <p className="text-xs text-destructive text-left">{emailError}</p>
            )}
            <InputGroup className="">
              <InputGroupInput
                id="password"
                aria-label="Password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                aria-invalid={!!passwordError}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="mt-2 absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-sidebar-accent/50"
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
              <InputGroupAddon align="block-start">
                <InputGroupText className="text-xs font-normal">
                  Password
                </InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            {passwordError && (
              <p className="text-xs text-destructive text-left">
                {passwordError}
              </p>
            )}

            <div className="flex justify-between w-full">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Checkbox
                  checked={remember}
                  onCheckedChange={(checked) => setRemember(checked)}
                />
                Keep me signed in on this device{" "}
              </div>
              <Button type="button" variant={"link"} onClick={openForgotDialog}>
                Forgot Password ?
              </Button>
            </div>

            {formError && (
              <p className="text-xs text-destructive text-left">{formError}</p>
            )}

            <Button type="submit" className={"w-full mt-1"} disabled={isBusy}>
              {isSigningIn ? (
                <>
                  <Loader2Icon className="animate-spin" />
                  Signing in
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
          <div className="flex justify-center items-center gap-3 mt-3">
            <div className="h-px w-full bg-foreground/5" />
            <p className="text-muted-foreground">or</p>
            <div className="h-px w-full bg-foreground/5" />
          </div>
          <Button
            type="button"
            variant={"outline_without_border"}
            className={"mt-3"}
            onClick={handleMagicLink}
            disabled={isBusy}
          >
            {isSendingLink ? (
              <>
                <Loader2Icon className="animate-spin" />
                Sending secure link
              </>
            ) : (
              "Continue with a secure email link "
            )}
          </Button>

          <p className="mt-3 text-muted-foreground">
            Need access? Contact your agency administrator.
          </p>
          {signupOpen && (
            <p className="mt-1 text-muted-foreground">
              New here?{" "}
              <Link
                href="/signup"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Create your agency workspace
              </Link>
            </p>
          )}
        </Card>
      </div>
    </>
  );
};

export default LoginForm;
