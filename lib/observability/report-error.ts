import { captureException } from "@sentry/core";

/**
 * Reports an error the code HANDLED, one that returned a friendly failure instead of throwing, so it would otherwise
 * be invisible to Sentry (TASK-028 P1.2). Imports `@sentry/core`, not `@sentry/nextjs`, so the same call works in the
 * web app and in the plain-Node worker; it reaches whichever SDK is initialised and does nothing when none is.
 *
 * `context` is a short stable name such as "sendStaffMessage.enqueue". It is the grouping key in Sentry, so keep it free
 * of ids and customer values. The error text is scrubbed before it leaves (see `scrub-event.ts`).
 */
export function reportHandledError(context: string, cause: unknown, ids?: { agencyId?: string; conversationId?: string }): void {
  try {
    const error = cause instanceof Error ? cause : new Error(typeof cause === "string" ? cause : "Unexpected non-error value");
    captureException(error, {
      tags: { inbox_context: context, handled: "true" },
      extra: {
        ...(ids?.agencyId ? { agency_id: ids.agencyId } : {}),
        ...(ids?.conversationId ? { conversation_id: ids.conversationId } : {}),
      },
      fingerprint: ["handled", context, error.name],
    });
  } catch {
    // Reporting must never be the thing that breaks the request it is reporting on.
  }
}
