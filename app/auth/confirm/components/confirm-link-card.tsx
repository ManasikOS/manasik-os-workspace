"use client";

import { AlertTriangle, Loader2Icon, ShieldCheck } from "lucide-react";
import Link from "next/link";
import React, { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/utils/supabase/client";

import { confirmAuthLinkAction } from "@/app/(auth)/actions";

interface ConfirmLinkCardProps {
  tokenHash?: string;
  type?: string;
  code?: string;
  next?: string;
}

type Phase =
  /** Query params carried neither a token_hash/code, nor a fragment we've checked yet. */
  | { kind: "checking" }
  /** `token_hash`/`type` or PKCE `code` in the query string — confirmAuthLinkAction() verifies it. */
  | { kind: "ready-server" }
  /**
   * Session tokens already minted, sitting in the URL FRAGMENT — see the
   * component doc comment below for why this happens and why it can only be
   * detected client-side.
   */
  | { kind: "ready-implicit"; accessToken: string; refreshToken: string; effectiveType?: string }
  | { kind: "invalid"; message: string };

const TYPE_COPY: Record<string, { title: string; description: string; cta: string }> = {
  invite: {
    title: "You've been invited",
    description: "Confirm this is you to continue and set up your password.",
    cta: "Confirm and continue",
  },
  recovery: {
    title: "Reset your password",
    description: "Confirm this is you to continue resetting your password.",
    cta: "Confirm and continue",
  },
  magiclink: {
    title: "Sign in",
    description: "Confirm this is you to sign in to your workspace.",
    cta: "Confirm and sign in",
  },
  email: {
    title: "Confirm your email",
    description: "Confirm this is you to continue.",
    cta: "Confirm and continue",
  },
};
const DEFAULT_COPY = { title: "Confirm it's you", description: "Click below to continue.", cta: "Confirm and continue" };

/** Same rule as `safeRedirectPath()` in `lib/site-url.ts`, duplicated here rather than
 *  imported — that module pulls in `next/headers`, which cannot run in a Client Component. */
function safeNext(next: string | undefined, fallback = "/dashboard") {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}

/**
 * Requires a real click before establishing a session — see
 * `confirmAuthLinkAction` in `app/(auth)/actions.ts` for why.
 *
 * Also handles a case a Server Component can never see at all: with the
 * *stock* `{{ .ConfirmationURL }}` email template on a Supabase project whose
 * Auth Flow Type is "implicit" rather than "PKCE", a SUCCESSFUL verification
 * at Supabase's own `/auth/v1/verify` redirects back here with the session
 * as `#access_token=...&refresh_token=...` in the URL FRAGMENT — fragments
 * never reach the server, so `token_hash`/`code` are both absent from
 * `searchParams` even though the link genuinely worked. This card checks
 * `window.location.hash` on mount and, if it finds a session there, offers
 * to accept it (`supabase.auth.setSession()` on the *browser* client, which
 * — via `@supabase/ssr` — writes the same cookies the server client reads,
 * same as the token_hash/code paths) instead of reporting the link invalid.
 *
 * The permanent fix is still switching the email templates to the
 * `{{ .TokenHash }}` form (app/(auth)/README.md) — that avoids Supabase's own
 * `/auth/v1/verify` entirely, which is also what closes the prefetch gap
 * this whole click-to-confirm page exists for. This fragment fallback only
 * makes the *current* stock-template configuration work end to end; it does
 * not, by itself, protect against an email scanner consuming the link
 * first — Supabase's own server already verified it by the time any of this
 * app's code runs.
 */
export default function ConfirmLinkCard({ tokenHash, type, code, next }: ConfirmLinkCardProps) {
  const [phase, setPhase] = useState<Phase>(() => (tokenHash || code ? { kind: "ready-server" } : { kind: "checking" }));
  const [pending, startTransition] = useTransition();
  // Guards the fragment read below against running twice — see the effect's
  // own comment for why that would otherwise corrupt state.
  const fragmentProcessed = useRef(false);

  useEffect(() => {
    // Synchronizing with an external system (the URL fragment, which a
    // Server Component can never see — fragments never reach the server) —
    // there is no render-time equivalent for reading window.location.hash.
    // Deliberately not folded into the lazy useState initializer above
    // either: that would run during the client's hydration render and
    // disagree with the server-rendered markup, causing a hydration
    // mismatch. Same shape as the precedent in
    // components/animate-ui/primitives/animate/tabs.tsx.
    //
    // The `fragmentProcessed` guard is required, not just tidy: this effect
    // clears the fragment via `history.replaceState` as its very first
    // action, so it is NOT idempotent — a second invocation would find the
    // hash already empty and incorrectly report a perfectly valid link as
    // "missing its confirmation code," overwriting the correct state the
    // first invocation just set. React's Strict Mode intentionally
    // double-invokes every effect once in development specifically to catch
    // bugs like this; without the guard, this one was invisible until a
    // real invite session hit it. Whatever runs first inside the effect
    // must win — this ref makes sure only one invocation's result sticks.
    if (fragmentProcessed.current) return;
    fragmentProcessed.current = true;

    const hash = window.location.hash;
    if (!hash) {
      if (!tokenHash && !code) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPhase({ kind: "invalid", message: "That link is missing its confirmation code. Request a new one." });
      }
      return;
    }

    const params = new URLSearchParams(hash.slice(1));
    const description = params.get("error_description");
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const fragmentType = params.get("type");

    // Drop the fragment either way — it carries either an error nobody needs
    // to see twice, or a live session that should not sit in the visible,
    // copy-pasteable URL a moment longer than necessary.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (description) {
      setPhase({ kind: "invalid", message: description.replace(/\+/g, " ") });
      return;
    }

    if (accessToken && refreshToken) {
      setPhase({ kind: "ready-implicit", accessToken, refreshToken, effectiveType: fragmentType ?? type });
      return;
    }

    if (!tokenHash && !code) {
      setPhase({ kind: "invalid", message: "That link is missing its confirmation code. Request a new one." });
    }
  }, [tokenHash, code, type]);

  const confirm = () => {
    if (phase.kind === "ready-server") {
      startTransition(async () => {
        const result = await confirmAuthLinkAction({ tokenHash, type, code, next });
        if (result.status === "error") {
          setPhase({ kind: "invalid", message: result.message ?? "That link has expired or was already used. Request a new one." });
        }
        // On success the action itself calls redirect() — nothing else to do.
      });
      return;
    }

    if (phase.kind === "ready-implicit") {
      const { accessToken, refreshToken } = phase;
      startTransition(async () => {
        const supabase = createClient();
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) {
          setPhase({ kind: "invalid", message: "That link has expired or was already used. Request a new one." });
          return;
        }
        // Hard navigation, not router.push — the next Server Component
        // render must see the cookies setSession() just wrote.
        window.location.assign(safeNext(next));
      });
    }
  };

  if (phase.kind === "checking") {
    return (
      <div className="flex h-screen w-full items-center justify-center px-6">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (phase.kind === "invalid") {
    return (
      <div className="flex h-screen w-full items-center justify-center px-6">
        <Card className="w-full max-w-sm py-8 px-6 text-center gap-4 bg-card/40! backdrop-blur-lg">
          <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Link expired or already used</h1>
          <p className="text-sm text-muted-foreground">{phase.message}</p>
          <Button render={<Link href="/login" />} variant="secondary" className="mt-2">
            Back to sign in
          </Button>
        </Card>
      </div>
    );
  }

  const effectiveType = phase.kind === "ready-implicit" ? phase.effectiveType : type;
  const copy = (effectiveType && TYPE_COPY[effectiveType]) || DEFAULT_COPY;

  return (
    <div className="flex h-screen w-full items-center justify-center px-6">
      <Card className="w-full max-w-sm py-8 px-6 text-center gap-4 bg-card/40! backdrop-blur-lg">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.description}</p>
        <Button onClick={confirm} disabled={pending} className="mt-2">
          {pending && <Loader2Icon className="animate-spin" />} {copy.cta}
        </Button>
      </Card>
    </div>
  );
}
