import { z } from "zod";

/**
 * The query Instagram appends when it redirects back to /api/oauth/instagram-login/callback. Everything is
 * optional because a cancelled login carries only `error`; the route decides what a missing `code` means.
 * Lengths are capped: this is attacker-reachable input, and the code is sent on to Meta.
 */
export const instagramLoginCallbackSchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(200).optional(),
  error_description: z.string().max(500).optional(),
});

/** The single-use authorization code handed to the connect server action. */
export const instagramLoginCodeSchema = z.object({
  code: z.string().min(1).max(2048),
});

export function parseInstagramLoginCallback(params: URLSearchParams) {
  return instagramLoginCallbackSchema.safeParse({
    code: params.get("code") ?? undefined,
    state: params.get("state") ?? undefined,
    error: params.get("error") ?? undefined,
    error_description: params.get("error_description") ?? undefined,
  });
}
