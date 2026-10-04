import "server-only";

import { randomUUID } from "node:crypto";

import type { ChannelErrorClass, ChannelRuntimeAdapter } from "@/lib/channels/adapter";

/**
 * The provider simulator, outbound half (TASK-032 S1/S3). A disposable test agency (`agencies.is_test`) never talks to Meta or any mail
 * server: the channel adapter it is given is this wrapper, which answers every send from memory. Nothing leaves the process, so the
 * production go-live gate can run the whole Inbox against a real production database without being able to message a real person.
 *
 * Everything else about the adapter is the real one (policy, connection lookup, delivery bookkeeping, error handling), so a test still
 * exercises the real send path up to the network call.
 *
 * Failures are injected by the RECIPIENT id of the conversation, so a test can ask for a failure without any switch in the app:
 *   `sim-fail-token-dead`, `sim-fail-rate-limited`, `sim-fail-unfunded`, `sim-fail-outside-window`, `sim-fail-not-registered`,
 *   `sim-fail-unknown`. Any other recipient succeeds.
 */

/** The token a simulated send is given, so nothing reads a secret from Vault for a test agency. */
export const SIMULATED_TOKEN = "simulated-token";

const FAILURE_BY_DIRECTIVE: Record<string, ChannelErrorClass> = {
  "token-dead": "TOKEN_DEAD",
  "rate-limited": "RATE_LIMITED",
  unfunded: "UNFUNDED",
  "outside-window": "OUTSIDE_SERVICE_WINDOW",
  "not-registered": "NOT_REGISTERED",
  unknown: "UNKNOWN",
};

/** A failure the simulator produced on purpose. The wrapped adapter classifies it as the class that was asked for. */
export class SimulatedProviderError extends Error {
  constructor(
    readonly errorClass: ChannelErrorClass,
    message: string,
  ) {
    super(message);
    this.name = "SimulatedProviderError";
  }
}

/** The failure a recipient id asks for, or `null` for a send that should succeed. */
export function simulatedFailureFor(recipient: string): ChannelErrorClass | null {
  const directive = /sim-fail-([a-z-]+)/.exec(recipient)?.[1];
  return directive ? (FAILURE_BY_DIRECTIVE[directive] ?? "UNKNOWN") : null;
}

/** A 1x1 PNG, so an inbound image from the simulator can be downloaded and stored like a real one. */
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function simulatedSend(provider: string, to: string): { externalMessageId: string } {
  const failure = simulatedFailureFor(to);
  if (failure) throw new SimulatedProviderError(failure, `Simulated ${failure.toLowerCase().replace(/_/g, " ")}`);
  return { externalMessageId: `sim.${provider.toLowerCase()}.${randomUUID()}` };
}

/** Wraps a real channel adapter so that every call that would reach the provider is answered locally. Idempotent. */
export function simulateChannelAdapter(base: ChannelRuntimeAdapter): ChannelRuntimeAdapter {
  if (base.simulated) return base;
  return {
    ...base,
    simulated: true,
    readToken: async () => SIMULATED_TOKEN,
    sendReply: async (_connection, _token, reply) => simulatedSend(base.provider, reply.to),
    ...(base.sendMedia ? { sendMedia: async (_connection, _token, media) => simulatedSend(base.provider, media.to) } : {}),
    ...(base.sendTyping ? { sendTyping: async () => undefined } : {}),
    ...(base.fetchAudio
      ? {
          fetchAudio: async () => {
            throw new SimulatedProviderError("UNKNOWN", "Audio downloads are not simulated.");
          },
        }
      : {}),
    ...(base.fetchAttachment
      ? {
          fetchAttachment: async () => ({
            bytes: ONE_PIXEL_PNG.buffer.slice(ONE_PIXEL_PNG.byteOffset, ONE_PIXEL_PNG.byteOffset + ONE_PIXEL_PNG.byteLength) as ArrayBuffer,
            mimeType: "image/png",
          }),
        }
      : {}),
    classifyError: (error) => (error instanceof SimulatedProviderError ? error.errorClass : base.classifyError(error)),
  };
}
