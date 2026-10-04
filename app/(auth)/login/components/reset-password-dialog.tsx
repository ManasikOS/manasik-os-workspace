"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  resetPasswordSchema,
  type AuthFieldErrors,
} from "@/lib/validations/auth";
import { Eye, EyeOff, Loader2Icon } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useState, useTransition } from "react";
import { z } from "zod";
import { updatePasswordAction } from "../../actions";

interface ResetPasswordDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  /**
   * "reset" (default) — a password-recovery link. "setup" — a Team
   * invitation's first-password link (`mode=setup`, B1 of
   * docs/modules/team-module-remediation-plan.md). Same action underneath
   * (`updatePasswordAction`) — only the copy differs.
   */
  mode?: "reset" | "setup";
}

/**
 * Shown after a recovery or invite link has signed the user in — the link
 * itself is the proof of identity, so we only need the new password here.
 */
const ResetPasswordDialog = ({ open, setOpen, mode = "reset" }: ResetPasswordDialogProps) => {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});
    setFormError(null);

    const parsed = resetPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setErrors(z.flattenError(parsed.error).fieldErrors as AuthFieldErrors);
      return;
    }

    startTransition(async () => {
      const result = await updatePasswordAction(parsed.data);

      if (result.status === "success") {
        setOpen(false);
        router.replace("/dashboard");
        return;
      }

      setErrors(result.errors ?? {});
      setFormError(result.message ?? null);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className={"text-center gap-0"}>
        <h2 className="text-3xl tracking-tighter font-medium">
          {mode === "setup" ? "Set your password" : "Set a new password"}
        </h2>
        <p className="mt-2 text-muted-foreground">
          {mode === "setup"
            ? "Choose a password to finish setting up your account."
            : "Choose a password you don't use anywhere else."}
        </p>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 mt-5 text-left"
        >
          <InputGroup>
            <InputGroupInput
              id="new-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={!!errors.password}
              disabled={isPending}
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
                New password
              </InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          {errors.password?.map((error) => (
            <p key={error} className="text-xs text-destructive">
              {error}
            </p>
          ))}

          <InputGroup>
            <InputGroupInput
              id="confirm-password"
              name="confirmPassword"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Re-enter your new password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-invalid={!!errors.confirmPassword}
              disabled={isPending}
            />
            <InputGroupAddon align="block-start">
              <InputGroupText className="text-xs font-normal">
                Confirm password
              </InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          {errors.confirmPassword?.[0] && (
            <p className="text-xs text-destructive">
              {errors.confirmPassword[0]}
            </p>
          )}

          {formError && <p className="text-xs text-destructive">{formError}</p>}

          <Button
            type="submit"
            variant={"bg_primary_gradient"}
            className={"w-full mt-1"}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2Icon className="animate-spin" />
                {mode === "setup" ? "Creating password" : "Updating password"}
              </>
            ) : mode === "setup" ? (
              "Create password"
            ) : (
              "Update password"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ResetPasswordDialog;
