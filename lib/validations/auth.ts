import { z } from "zod";

/**
 * Shared auth schemas. They run twice on purpose: once in the browser for
 * instant feedback, and once inside the Server Action, which is the real gate.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, { error: "Work email is required." })
  .pipe(z.email({ error: "Enter a valid email address." }));

const newPassword = z
  .string()
  .min(8, { error: "Use at least 8 characters." })
  .max(72, { error: "Use 72 characters or fewer." })
  .regex(/[a-zA-Z]/, { error: "Include at least one letter." })
  .regex(/[0-9]/, { error: "Include at least one number." });

export const signInSchema = z.object({
  email,
  password: z.string().min(1, { error: "Password is required." }),
  // The "keep me signed in" checkbox is submitted as "true" / "false".
  remember: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "on"),
});

export const emailSchema = z.object({ email });

export const signupSchema = z.object({
  agencyName: z.string().trim().min(2, { error: "Enter your agency's name." }).max(120),
  ownerFullName: z.string().trim().min(2, { error: "Enter your full name." }).max(120),
  email,
  // Optional ISO 3166-1 alpha-2 code. Empty means "not provided"; the setup
  // guide asks again later, so signup never blocks on it.
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => (value === "" ? undefined : value))
    .pipe(z.string().regex(/^[A-Z]{2}$/, { error: "Use a two-letter country code." }).optional())
    .optional(),
});

export const resetPasswordSchema = z
  .object({
    password: newPassword,
    confirmPassword: z.string().min(1, { error: "Confirm your new password." }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    error: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type EmailInput = z.infer<typeof emailSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type SignupInput = z.infer<typeof signupSchema>;

export type AuthFieldErrors = Record<string, string[] | undefined>;

export type AuthActionState = {
  status: "idle" | "error" | "success";
  message?: string;
  errors?: AuthFieldErrors;
  /** Echoed back so the UI can show which inbox the link was sent to. */
  email?: string;
};

export const idleAuthState: AuthActionState = { status: "idle" };

/** Turns a failed `safeParse` into the state shape every auth form consumes. */
export function toFieldErrorState(error: z.ZodError): AuthActionState {
  return {
    status: "error",
    errors: z.flattenError(error).fieldErrors as AuthFieldErrors,
  };
}
