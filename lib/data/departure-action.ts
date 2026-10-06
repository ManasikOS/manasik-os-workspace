import "server-only";

import type { z } from "zod";

import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";
import { requireUser } from "@/lib/dal";
import { getCurrentDepartureCapabilities } from "@/lib/data/departure-groups";
import { toDepartureGroupFieldErrors, type DepartureGroupFieldErrors } from "@/lib/validations/departure-groups";

/**
 * The shared front half of a Departure Groups Server Action.
 *
 * Every action in this module has to do the same four things, in this order, before it touches
 * anything: sign the caller in (`requireUser`), resolve their capabilities (base role plus any
 * custom-role overrides), refuse if they lack the one this action needs, and validate the payload.
 * Copied by hand into 70-odd actions, that sequence is exactly where a step gets forgotten (a
 * missing `requireUser`, a gate on the wrong capability, an unvalidated field). This runs it once,
 * the same way every time, and hands the handler a payload that has already been parsed.
 *
 * Group scope (a guide only on assigned groups, Marketing only on groups on sale) is enforced
 * where the write happens, in `mutate()`, so a handler that goes through the data layer gets it
 * without asking.
 *
 * Use it for new actions, and move an existing action over when you next change it.
 */

export type DepartureActionFailure = {
  ok: false;
  error: string;
  fieldErrors?: DepartureGroupFieldErrors;
};

export interface DepartureActionConfig<TSchema extends z.ZodType> {
  /** The capability the caller must hold. */
  capability: keyof DepartureGroupCapabilities;
  /** Shown when the caller lacks it, e.g. "Your role cannot cancel bookings." */
  denied: string;
  schema: TSchema;
  /**
   * What to tell the caller when the payload does not validate. Default: the generic
   * "Check the highlighted fields" message, with the per-field errors attached.
   */
  invalidMessage?: (error: z.ZodError) => string;
}

export interface DepartureActionContext {
  user: Awaited<ReturnType<typeof requireUser>>;
  capabilities: DepartureGroupCapabilities;
}

export async function runDepartureAction<TSchema extends z.ZodType, TResult extends { ok: boolean }>(
  config: DepartureActionConfig<TSchema>,
  input: unknown,
  handler: (data: z.infer<TSchema>, context: DepartureActionContext) => Promise<TResult>,
): Promise<TResult | DepartureActionFailure> {
  const user = await requireUser();

  const capabilities = await getCurrentDepartureCapabilities();
  if (!capabilities[config.capability]) {
    return { ok: false, error: config.denied };
  }

  const parsed = config.schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: config.invalidMessage?.(parsed.error) ?? "Check the highlighted fields and try again.",
      fieldErrors: toDepartureGroupFieldErrors(parsed.error),
    };
  }

  return handler(parsed.data, { user, capabilities });
}
