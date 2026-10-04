import { redirect } from "next/navigation";

import ConfirmLinkCard from "./components/confirm-link-card";

/**
 * Click-to-confirm landing page for every Supabase email link (magic link,
 * password recovery, Team invitation) — see `confirmAuthLinkAction` in
 * `app/(auth)/actions.ts` for why this is a page requiring a real click
 * rather than the route handler it used to be: an automated GET here (an
 * email client's link-safety scanner, not a person) must never be able to
 * consume the token.
 *
 * This Server Component does no verification itself — it only reads the
 * link's query params and hands them to the client card, which performs the
 * actual confirm on click. It deliberately does NOT redirect away when
 * `tokenHash`/`code` are both missing: with the *stock*
 * `{{ .ConfirmationURL }}` template on a project whose Auth Flow Type is
 * "implicit" (rather than PKCE), a SUCCESSFUL verification at Supabase's own
 * `/auth/v1/verify` comes back as `#access_token=&refresh_token=...` in the
 * URL FRAGMENT — which a Server Component can never see (fragments never
 * reach the server). Only the client card can detect that case; this
 * component just hands off and lets it decide.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{
    token_hash?: string;
    type?: string;
    code?: string;
    next?: string;
    error?: string;
  }>;
}) {
  const { token_hash: tokenHash, type, code, next, error } = await searchParams;

  if (error) {
    redirect("/login?error=link_expired");
  }

  return <ConfirmLinkCard tokenHash={tokenHash} type={type} code={code} next={next} />;
}
