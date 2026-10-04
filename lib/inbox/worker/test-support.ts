/**
 * Shared fakes for the worker tests: an in-memory `channel_jobs` behind the same RPC surface the real queue exposes (the SQL itself is
 * proven against Postgres by scripts/sql/verify-q1-reply-queue.sql and verify-q2-queue-claim.sql), and a polling helper. Not imported
 * by production code.
 */

export const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const jobUuid = (n: number) => `3f1d2c4e-5a6b-4c7d-8e9f-${String(n).padStart(12, "0")}`;

export interface FakeJob {
  id: string;
  agency_id: string;
  lane: string;
  kind: string;
  coalesce_key: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  status: "QUEUED" | "RUNNING" | "DONE" | "DEAD";
  locked_by?: string | null;
}

export function fakeQueueDb(seed: Array<Partial<FakeJob> & { id: string }>) {
  const jobs: FakeJob[] = seed.map((job) => ({
    agency_id: AGENCY, lane: "REALTIME", kind: "REPLY", coalesce_key: null, payload: {}, attempts: 0, max_attempts: 3, status: "QUEUED" as const, ...job,
  }));
  const claimLimits: number[] = [];
  const staleReleases: number[] = [];
  const db = {
    jobs,
    claimLimits,
    staleReleases,
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_channel_jobs") {
        claimLimits.push(args.p_limit as number);
        const claimed = jobs.filter((job) => job.status === "QUEUED" && job.lane === args.p_lane).slice(0, args.p_limit as number);
        for (const job of claimed) {
          job.status = "RUNNING";
          job.locked_by = args.p_worker_id as string;
          job.attempts += 1;
        }
        return { data: claimed.map((job) => ({ ...job })), error: null };
      }
      const mine = () => jobs.find((row) => row.id === args.p_id && row.status === "RUNNING" && row.locked_by === args.p_worker_id);
      if (name === "complete_channel_job") {
        const job = mine();
        if (job) job.status = "DONE";
        return { data: Boolean(job), error: null };
      }
      if (name === "fail_channel_job") {
        const job = mine();
        if (!job) return { data: null, error: null };
        job.status = job.attempts >= job.max_attempts ? "DEAD" : "QUEUED";
        job.locked_by = null;
        // A retried job is backed off in Postgres; the fake parks it so a test does not spin on it.
        if (job.status === "QUEUED") job.lane = "BACKED_OFF";
        return { data: job.status, error: null };
      }
      if (name === "release_channel_job") {
        const job = mine();
        if (!job) return { data: false, error: null };
        job.status = "QUEUED";
        job.locked_by = null;
        job.attempts = Math.max(job.attempts - 1, 0);
        return { data: true, error: null };
      }
      if (name === "release_stale_channel_jobs") {
        staleReleases.push(Date.now());
        return { data: 0, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  };
  return db;
}

/** A promise whose resolution the test controls, to hold a handler open. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Waits until `condition` holds, polling; fails the test with `what` if it does not within `timeoutMs`. */
export async function until(condition: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
