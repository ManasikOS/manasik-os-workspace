import {
  deliverSignedWebhook,
  pageTextMessage,
  requestWebhookHandshake,
  whatsappTextMessage,
  type SimulatedChannel,
} from "../../inbox/simulator/inbound-payloads";
import { checkConfig, combine } from "./evaluate";
import type { GateCheckResult, GateConfigReport, GateContext } from "./types";

const TIMEOUT_MS = 10_000;

function http(context: GateContext): typeof fetch {
  const base = context.fetchImpl ?? fetch;
  return (input, init) => base(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS) });
}

function describeFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message.slice(0, 160) : "unknown error";
}

async function getJson(context: GateContext, url: string, headers?: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const response = await http(context)(url, { headers, cache: "no-store" });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON answer is reported by the caller through the status and the missing fields.
  }
  return { status: response.status, body };
}

/** G1: the app answers, its database answers, and (when told which commit should be live) it is that commit. */
export async function checkLiveness(context: GateContext): Promise<GateCheckResult> {
  try {
    const live = await getJson(context, new URL("/api/health", context.baseUrl).toString());
    const ready = await getJson(context, new URL("/api/health/ready", context.baseUrl).toString());
    const liveBody = live.body as { status?: string; build?: string } | null;
    const readyBody = ready.body as { status?: string } | null;
    const problems: string[] = [];
    if (live.status !== 200 || liveBody?.status !== "ok") problems.push(`/api/health answered ${live.status}`);
    if (ready.status !== 200 || readyBody?.status !== "ready") problems.push(`/api/health/ready answered ${ready.status}`);
    const build = liveBody?.build ?? "unknown";
    if (context.expectedCommit && build !== context.expectedCommit.slice(0, 7)) problems.push(`live build is ${build}, expected ${context.expectedCommit.slice(0, 7)}`);
    if (problems.length > 0) return { id: "G1", title: "Liveness and build", status: "FAIL", detail: `${problems.length} problem(s).`, items: problems };
    if (!context.expectedCommit) return { id: "G1", title: "Liveness and build", status: "PENDING", detail: `The app is up and ready (build ${build}), but the build was not compared: set GATE_EXPECTED_COMMIT to the commit that should be live.` };
    return { id: "G1", title: "Liveness and build", status: "PASS", detail: `The app is up, its database answers, and build ${build} is the expected commit.` };
  } catch (cause) {
    return { id: "G1", title: "Liveness and build", status: "FAIL", detail: `The app could not be reached: ${describeFailure(cause)}.` };
  }
}

async function fetchConfig(context: GateContext, baseUrl: string, secret: string): Promise<GateConfigReport> {
  const result = await getJson(context, new URL("/api/health/config", baseUrl).toString(), { Authorization: `Bearer ${secret}` });
  if (result.status !== 200) throw new Error(`/api/health/config answered ${result.status}`);
  return result.body as GateConfigReport;
}

/** G6: the deployment's own configuration report, judged against the expected environment and, for production, against staging. */
export async function checkConfiguration(context: GateContext): Promise<GateCheckResult> {
  if (!context.cronSecret) return { id: "G6", title: "Configuration", status: "FAIL", detail: "GATE_CRON_SECRET is not set, so the configuration endpoint cannot be read." };
  try {
    const config = await fetchConfig(context, context.baseUrl, context.cronSecret);
    const reference = context.reference ? await fetchConfig(context, context.reference.baseUrl, context.reference.cronSecret) : undefined;
    return checkConfig(config, context.expectedEnvironment, reference);
  } catch (cause) {
    return { id: "G6", title: "Configuration", status: "FAIL", detail: `The configuration could not be read: ${describeFailure(cause)}.` };
  }
}

/** G7: the always-on worker is deployed and healthy. Pending until a worker URL is supplied, because production has none yet. */
export async function checkWorker(context: GateContext): Promise<GateCheckResult> {
  if (!context.workerUrl) return { id: "G7", title: "Worker", status: "PENDING", detail: "No worker URL was supplied (GATE_WORKER_URL). The worker is not deployed yet or its address is not given." };
  try {
    const health = await getJson(context, new URL("/healthz", context.workerUrl).toString());
    const readiness = await getJson(context, new URL("/readyz", context.workerUrl).toString());
    const problems: string[] = [];
    if (health.status !== 200) problems.push(`/healthz answered ${health.status}`);
    if (readiness.status !== 200) problems.push(`/readyz answered ${readiness.status}`);
    return problems.length === 0
      ? { id: "G7", title: "Worker", status: "PASS", detail: "The worker's /healthz and /readyz both answer 200." }
      : { id: "G7", title: "Worker", status: "FAIL", detail: `${problems.length} problem(s).`, items: problems };
  } catch (cause) {
    return { id: "G7", title: "Worker", status: "FAIL", detail: `The worker could not be reached: ${describeFailure(cause)}.` };
  }
}

const CHANNELS: SimulatedChannel[] = ["WHATSAPP", "MESSENGER", "INSTAGRAM"];
const FORGED_SIGNATURE = `sha256=${"0".repeat(64)}`;

function webhookPayload(channel: SimulatedChannel) {
  return channel === "WHATSAPP"
    ? whatsappTextMessage({ phoneNumberId: "sim-gate-probe" }, { from: "10000000000", text: "gate probe" })
    : pageTextMessage(channel, "sim-gate-probe", { senderId: "sim-gate-sender", text: "gate probe" });
}

/**
 * G8, the part that needs no secret and no agency: a delivery that is unsigned or wrongly signed is refused (401), a handshake with the wrong
 * token is refused (403), and a handshake with the right token, when it is supplied, is answered with the challenge. A deployment that answers
 * 200 to a forged event has no app secret configured, which is the failure this exists to catch.
 */
export async function checkWebhookSecurity(context: GateContext): Promise<GateCheckResult> {
  const parts: GateCheckResult[] = [];
  for (const channel of CHANNELS) {
    const title = channel.charAt(0) + channel.slice(1).toLowerCase();
    try {
      const options = { baseUrl: context.baseUrl, channel, payload: webhookPayload(channel), appSecret: "gate-not-the-real-secret", fetchImpl: http(context) };
      const forged = await deliverSignedWebhook({ ...options, signatureOverride: FORGED_SIGNATURE });
      const unsigned = await deliverSignedWebhook({ ...options, signatureOverride: null });
      const wrongToken = await requestWebhookHandshake({ baseUrl: context.baseUrl, channel, verifyToken: "gate-wrong-token", fetchImpl: http(context) });
      const problems: string[] = [];
      if (forged.status !== 401) problems.push(`a forged signature was answered ${forged.status}, expected 401`);
      if (unsigned.status !== 401) problems.push(`an unsigned event was answered ${unsigned.status}, expected 401`);
      if (wrongToken.status !== 403) problems.push(`a wrong verify token was answered ${wrongToken.status}, expected 403`);

      const token = context.verifyTokens[channel];
      if (token) {
        const right = await requestWebhookHandshake({ baseUrl: context.baseUrl, channel, verifyToken: token, fetchImpl: http(context) });
        if (right.status !== 200 || right.body !== right.challenge) problems.push(`the handshake with the right token was answered ${right.status} without echoing the challenge`);
      }
      if (problems.length > 0) parts.push({ id: "G8", title, status: "FAIL", detail: problems.join("; ") });
      else if (!token) parts.push({ id: "G8", title, status: "PENDING", detail: `forged and unsigned events and a wrong token are refused; the handshake with the real token was not tried (GATE_VERIFY_TOKEN_${channel} not set)` });
      else parts.push({ id: "G8", title, status: "PASS", detail: "refuses forged and unsigned events and a wrong token, and answers the real handshake" });
    } catch (cause) {
      parts.push({ id: "G8", title, status: "FAIL", detail: `could not be reached: ${describeFailure(cause)}` });
    }
  }
  return combine("G8", "Webhook security", parts, "Every webhook refuses forged and unsigned events and a wrong verify token, and answers its real handshake.");
}

/** G13: a previous production deployment exists to roll back to. Pending until a Vercel token is supplied. */
export async function checkRollback(context: GateContext): Promise<GateCheckResult> {
  if (!context.vercel) return { id: "G13", title: "Rollback", status: "PENDING", detail: "Not checked: set GATE_VERCEL_TOKEN and GATE_VERCEL_PROJECT to confirm a previous production deployment exists." };
  try {
    const url = new URL("https://api.vercel.com/v6/deployments");
    url.searchParams.set("projectId", context.vercel.projectId);
    url.searchParams.set("target", "production");
    url.searchParams.set("state", "READY");
    url.searchParams.set("limit", "5");
    if (context.vercel.teamId) url.searchParams.set("teamId", context.vercel.teamId);
    const result = await getJson(context, url.toString(), { Authorization: `Bearer ${context.vercel.token}` });
    if (result.status !== 200) return { id: "G13", title: "Rollback", status: "FAIL", detail: `Vercel answered ${result.status}.` };
    const count = ((result.body as { deployments?: unknown[] } | null)?.deployments ?? []).length;
    return count >= 2
      ? { id: "G13", title: "Rollback", status: "PASS", detail: `${count} ready production deployments exist, so the previous one can be restored.` }
      : { id: "G13", title: "Rollback", status: "FAIL", detail: `Only ${count} ready production deployment(s): there is nothing earlier to roll back to.` };
  } catch (cause) {
    return { id: "G13", title: "Rollback", status: "FAIL", detail: `Vercel could not be reached: ${describeFailure(cause)}.` };
  }
}
