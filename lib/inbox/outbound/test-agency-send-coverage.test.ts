import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TASK-032 S1. A disposable test agency must never reach a real provider, so every place that contacts a customer has to ask the
 * test-agency guard first. This scans the source for the calls that contact a customer and fails when one appears in a file that has not
 * been checked, so a NEW send path cannot be added without someone deciding how it is guarded.
 */
const root = process.cwd();
const SEND_CALL = /\b(sendTemplate|sendText|sendInteractiveButtons|sendMedia)\(|\.sendReply\(|\.sendMedia\(/;

/** Files that make the send, and how each one is guarded. */
const GUARDED: Record<string, string> = {
  "lib/inbox/outbox/drain.ts": "authorizeProviderSend",
  "lib/agent/whatsapp/reply-delivery.ts": "authorizeProviderSend",
  "lib/inbox/media/unsupported-notice.ts": "testAgencySendRefusal",
  "lib/whatsapp/send-template-message.ts": "loadAgencyIsTest",
  "app/(main)/relationships/announcements/actions.ts": "testAgencySendRefusal",
  "app/(main)/management/settings/integrations/whatsapp-actions.ts": "testAgencySendRefusal",
};

/** Files that only DEFINE or wrap the provider calls; the guard sits in their callers above. */
const DEFINITIONS = new Set([
  "lib/whatsapp/client.ts",
  "lib/channels/whatsapp-adapter.ts",
  "lib/channels/page-channel-adapter.ts",
  "lib/channels/adapter.ts",
  "lib/channels/instagram/adapter.ts",
  "lib/channels/messenger/adapter.ts",
  "lib/channels/email/adapter.ts",
]);

/** Code only: comments mention the send functions by name without calling them. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", "dist-worker", "e2e", ".git"].includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

const files = ["lib", "app", "worker"].flatMap((dir) => sourceFiles(join(root, dir)));

describe("test-agency send guard coverage", () => {
  it.each(["lib/inbox/outbox/drain.ts", "lib/agent/whatsapp/reply-delivery.ts"])("%s checks that the adapter and the authorization agree before it sends", (path) => {
    expect(readFileSync(join(root, path), "utf8")).toContain("assertSendMatchesAdapter(authorization, adapter)");
  });

  it("takes every channel adapter through the per-agency selector, so a test agency is always given the simulator", () => {
    const direct = files
      .map((file) => relative(root, file).replace(/\\/g, "/"))
      .filter((path) => path !== "lib/inbox/simulator/adapter-for-agency.ts" && path !== "lib/channels/registry.ts")
      .filter((path) => /\bgetChannelAdapter\(/.test(withoutComments(readFileSync(join(root, path), "utf8"))));
    expect(direct, "use getChannelAdapterForAgency; the only exception is a path that never sends and is guarded by testAgencySendRefusal").toEqual(["lib/inbox/media/unsupported-notice.ts"]);
  });

  it.each(Object.entries(GUARDED))("%s asks the guard before it sends", (path, marker) => {
    const source = readFileSync(join(root, path), "utf8");
    expect(source).toContain(marker);
    expect(SEND_CALL.test(withoutComments(source)), `${path} still contains a send call`).toBe(true);
  });

  it("asks the outbound allow-list at every send path: the authorization (outbox and AI replies) and each direct sender", () => {
    const viaAuthorize = new Set(["lib/inbox/outbox/drain.ts", "lib/agent/whatsapp/reply-delivery.ts"]);
    expect(readFileSync(join(root, "lib/inbox/outbound/authorize-provider-send.ts"), "utf8")).toContain("outboundRecipientRefusal");
    for (const path of Object.keys(GUARDED).filter((guarded) => !viaAuthorize.has(guarded))) {
      expect(readFileSync(join(root, path), "utf8"), `${path} must ask the outbound allow-list`).toContain("outboundRecipientRefusal");
    }
  });

  it("finds no file that contacts a customer without being listed above", () => {
    const unlisted = files
      .map((file) => relative(root, file).replace(/\\/g, "/"))
      .filter((path) => !(path in GUARDED) && !DEFINITIONS.has(path))
      .filter((path) => SEND_CALL.test(withoutComments(readFileSync(join(root, path), "utf8"))));
    expect(unlisted, "add the new send path to GUARDED with the guard it uses, or to DEFINITIONS if it only defines the call").toEqual([]);
  });
});
