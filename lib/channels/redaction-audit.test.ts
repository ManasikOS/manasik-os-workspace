/**
 * Phase 8 — no secret in any log. Two kinds of check:
 *
 *  1. A static audit: every `console.*` call in the Meta channel code is scanned, and none may put a token, a
 *     secret, an authorization header, an OAuth code or a signed request into what it logs. A new log line that
 *     does fails this test, which is the point: it turns "nobody should log a token" into something enforced.
 *  2. Runtime checks that the error text built from a failed Meta call, and from a failed database write, carries
 *     Meta's explanation and the database's code — and nothing else that could hold a credential or a customer's
 *     message.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { MetaGraphError as MetaGraphFailure } from "@/lib/meta/graph";

vi.mock("server-only", () => ({}));

const { MetaGraphError, metaGraphFetch } = await import("@/lib/meta/graph");
const { ChannelPersistenceError, describePersistenceCause } = await import("@/lib/data/channel-connection-repository");

const ROOT = process.cwd();

/* ── the auditor ─────────────────────────────────────────────────────────── */

/** Names that mean "this is a credential". `code` only counts as a bare identifier (`error.code` is a status code). */
const FORBIDDEN = /\w*token\w*|\w*secret\w*|authorization|bearer|credentialref|credential_ref|signedrequest|signed_request|(?<![.\w])code(?!\w)/i;

/** The code inside a console call's arguments, with string text removed but `${…}` expressions kept. */
export function loggedCode(argumentsText: string): string {
  let code = "";
  let i = 0;
  while (i < argumentsText.length) {
    const char = argumentsText[i];
    if (char === "'" || char === '"') {
      i += 1;
      while (i < argumentsText.length && argumentsText[i] !== char) i += argumentsText[i] === "\\" ? 2 : 1;
      i += 1;
      code += " ";
    } else if (char === "`") {
      i += 1;
      while (i < argumentsText.length && argumentsText[i] !== "`") {
        if (argumentsText[i] === "\\") {
          i += 2;
        } else if (argumentsText[i] === "$" && argumentsText[i + 1] === "{") {
          let depth = 1;
          let j = i + 2;
          while (j < argumentsText.length && depth > 0) {
            if (argumentsText[j] === "{") depth += 1;
            if (argumentsText[j] === "}") depth -= 1;
            j += 1;
          }
          code += ` ${argumentsText.slice(i + 2, j - 1)} `;
          i = j;
        } else {
          i += 1;
        }
      }
      i += 1;
      code += " ";
    } else {
      code += char;
      i += 1;
    }
  }
  return code;
}

/** Every `console.<level>(…)` call in a source text, as the text between its parentheses. */
export function consoleCalls(source: string): string[] {
  const calls: string[] = [];
  const start = /console\.(?:log|info|warn|error|debug|trace)\(/g;
  for (let match = start.exec(source); match; match = start.exec(source)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const begin = i;
    let quote: string | null = null;
    while (i < source.length && depth > 0) {
      const char = source[i];
      if (quote) {
        if (char === "\\") i += 1;
        else if (char === quote) quote = null;
      } else if (char === "'" || char === '"' || char === "`") quote = char;
      else if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      i += 1;
    }
    calls.push(source.slice(begin, i - 1));
  }
  return calls;
}

export function forbiddenInLogs(source: string): string[] {
  return consoleCalls(source).filter((call) => FORBIDDEN.test(loggedCode(call)));
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the auditor itself", () => {
  it("flags a token, a secret, a header, a code or a signed request in a log call", () => {
    for (const bad of [
      "console.error('failed', accessToken)",
      "console.warn(`sent with ${pageToken}`)",
      "console.info('x', { secret })",
      "console.log(request.headers.authorization)",
      "console.error('exchange failed', code)",
      "console.log(signedRequest)",
      "console.log(process.env.META_APP_SECRET)",
      "console.log(`Bearer ${credentialRef}`)",
    ]) {
      expect(forbiddenInLogs(bad), bad).toHaveLength(1);
    }
  });

  it("allows words in the message text and ordinary error logging", () => {
    for (const fine of [
      "console.warn('Messenger token rejected:', error instanceof Error ? error.message : error)",
      "console.error(`${channelName} webhook: META_APP_SECRET is not configured.`)",
      "console.error('lookup failed:', error.code, error.message)",
      "console.info(`disconnected ${result.disconnected}, failed ${result.failed}.`)",
      "console.error('WhatsApp signup: no WABA in the token. Granted:', granted)",
    ]) {
      expect(forbiddenInLogs(fine), fine).toHaveLength(0);
    }
  });

  it("finds a call that spans lines and one with nested parentheses", () => {
    expect(forbiddenInLogs("console.error(\n  'failed',\n  fn(pageToken),\n)")).toHaveLength(1);
    expect(consoleCalls("a(); console.warn(f(g(1)), 'x'); b()")).toEqual(["f(g(1)), 'x'"]);
  });
});

/* ── the audit of the real code ──────────────────────────────────────────── */

const AUDITED = [
  "lib/channels",
  "lib/meta",
  "lib/whatsapp/connect.ts",
  "lib/whatsapp/client.ts",
  "lib/data/channel-connection-repository.ts",
  "app/api/oauth",
  "app/api/webhooks/messenger",
  "app/api/webhooks/instagram",
  "app/api/webhooks/meta",
  "app/(main)/management/settings/integrations",
];

describe("the Meta channel code never logs a credential", () => {
  const files = AUDITED.flatMap((entry) => {
    const path = join(ROOT, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });

  it("audits a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  for (const file of files) {
    const name = relative(ROOT, file).split(sep).join("/");
    const source = readFileSync(file, "utf8");
    if (!source.includes("console.")) continue;
    it(`${name}: no console call carries a token, secret, header, code or signed request`, () => {
      expect(forbiddenInLogs(source)).toEqual([]);
    });
  }
});

/* ── runtime: what error text can contain ───────────────────────────────── */

afterEach(() => vi.restoreAllMocks());

describe("error text from Meta and from the database", () => {
  const TOKEN = "EAAB-very-secret-page-token-123";

  it("a failed Graph call names Meta's explanation and the path, never the token it was called with", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid OAuth access token.", code: 190 } }), { status: 400 }));
    const failure = await metaGraphFetch({ host: "facebook", version: "v25.0" }, "/me/messages", TOKEN, { retries: 0 }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MetaGraphError);
    const text = `${(failure as Error).message} ${JSON.stringify((failure as MetaGraphFailure).body)}`;
    expect(text).toContain("Invalid OAuth access token.");
    expect(text).not.toContain(TOKEN);
  });

  it("sends the token in the Authorization header, never in the URL where it would be logged by proxies", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await metaGraphFetch({ host: "facebook", version: "v25.0" }, "/me/accounts?fields=id", TOKEN);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("a database failure reports its code and message, not the row Postgres quotes in its details", () => {
    const cause = {
      code: "23514",
      message: 'new row for relation "channel_webhook_events" violates check constraint',
      details: 'Failing row contains ({"entry":[{"messaging":[{"message":{"text":"my passport number is N1234567"}}]}]}).',
      hint: null,
    };
    const text = new ChannelPersistenceError("channel_webhook_events", "insert", cause).message;
    expect(text).toContain("23514");
    expect(text).toContain("violates check constraint");
    expect(text).not.toContain("passport");
    expect(describePersistenceCause(cause)).not.toContain("N1234567");
  });

  it("describes an error object, a plain error and an unknown value without leaking or throwing", () => {
    expect(describePersistenceCause(new Error("connection reset"))).toBe("connection reset");
    expect(describePersistenceCause({ message: "boom" })).toBe("boom");
    expect(describePersistenceCause(null)).toBe("unknown database error");
    expect(describePersistenceCause("secret-string")).toBe("unknown database error");
  });
});
