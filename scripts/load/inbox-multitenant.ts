import { writeFileSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  buildLoadProfileShape,
  pickAgencyIndex,
  planInjectionSchedule,
  summarizeLatencies,
  summarizeNoisyNeighbour,
  throughputPerSecond,
  totalJobs,
  totalSeconds,
} from "./inbox-load-profiles";
import {
  assertInboxLoadTestStagingTarget,
  parseInboxLoadTestOptions,
} from "./inbox-multitenant-config";

loadEnvConfig(process.cwd());

const AGENCIES = 50;
const CONVERSATIONS_PER_AGENCY = 200;
/** After the last job is created, how long the workers get to finish the backlog before the run is judged. */
const DRAIN_TIMEOUT_MS = 300_000;
const POLL_MS = 750;
const QUEUE_AGE_SAMPLE_MS = 5_000;
const KICK_INTERVAL_MS = 2_000;
const runId = crypto.randomUUID();
const agencyIds = (process.env.LOAD_TEST_AGENCY_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
/**
 * Optional. A real webhook kicks a short REALTIME drain the moment it stores a message; directly inserted jobs do not, so
 * without this the only trigger is pg_cron once a minute and latency would measure the cron interval, not the workers. When
 * set (the deployment that serves this database's cron), the runner calls the REALTIME lane route every couple of seconds
 * with CRON_SECRET, mimicking those after-webhook kicks.
 */
const workerUrl = process.env.LOAD_TEST_WORKER_URL?.replace(/\/+$/, "");
const cronSecret = process.env.CRON_SECRET;
const options = parseInboxLoadTestOptions(process.argv.slice(2));
const shape = buildLoadProfileShape(options.profile, { minutes: options.minutes, agencies: AGENCIES, conversationsPerAgency: CONVERSATIONS_PER_AGENCY });
const plannedJobs = totalJobs(shape);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type JobRow = { id: string; agency_id: string; status: string; created_at: string; updated_at: string; last_error: string | null };

if (!options.execute) {
  const schedule = planInjectionSchedule(shape);
  const peak = Math.max(...schedule);
  console.log(
    `Dry plan (${options.profile}): ${plannedJobs} ENRICH jobs across ${AGENCIES} disposable agencies` +
      (shape.instantJobs === null
        ? ` over ${totalSeconds(shape)}s (${shape.phases.map((phase) => `${phase.minutes}min @ ${phase.ratePerMinute}/min`).join(", then ")}; peak ${peak}/s)` + (shape.noisyShare > 0 ? `, ${Math.round(shape.noisyShare * 100)}% from ONE agency` : "")
        : ", all queued at once") +
      `. No database connection or write is made; re-run with --execute.`,
  );
} else {
  assertInboxLoadTestStagingTarget(process.env);
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const fixtureAgencyIds = options.seedFixtures ? await seedInboxLoadFixtures(db) : [];
  const targetAgencyIds = options.seedFixtures ? fixtureAgencyIds : agencyIds;
  if (targetAgencyIds.length !== AGENCIES) throw new Error(`LOAD_TEST_AGENCY_IDS must contain exactly ${AGENCIES} isolated agencies, or pass --seed-fixtures.`);
  // Agency index 0 is the noisy tenant in the noisy-tenant profile.
  const noisyAgencyId = targetAgencyIds[0];

  const conversationsByAgency = new Map<string, string[]>();
  for (const agencyId of targetAgencyIds) {
    const { data, error } = await db.from("conversations").select("id").eq("agency_id", agencyId).order("last_activity_at", { ascending: false }).limit(CONVERSATIONS_PER_AGENCY);
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((row) => String(row.id));
    if (ids.length !== CONVERSATIONS_PER_AGENCY) throw new Error(`${agencyId} needs ${CONVERSATIONS_PER_AGENCY} seeded conversations; found ${ids.length}.`);
    conversationsByAgency.set(agencyId, ids);
  }

  const startedAt = Date.now();
  let created = 0;
  let injectionFinishedAt: number | null = null;
  const queueAgeSamplesMs: number[] = [];
  let stop = false;

  const injectSecond = async (count: number) => {
    const now = new Date().toISOString();
    const rows = Array.from({ length: count }, () => {
      const jobNumber = created;
      created += 1;
      const agencyId = targetAgencyIds[pickAgencyIndex(jobNumber, AGENCIES, shape.noisyShare)];
      const conversations = conversationsByAgency.get(agencyId) ?? [];
      const conversationId = conversations[jobNumber % conversations.length];
      return {
        agency_id: agencyId,
        lane: "REALTIME",
        kind: "ENRICH",
        // Unique per job: a coalesced (merged) job would hide load instead of measuring it.
        coalesce_key: `load:${runId}:${jobNumber}`,
        payload: { loadRunId: runId, conversationId, seq: jobNumber },
        priority: 100,
        run_after: now,
        max_attempts: 1,
      };
    });
    for (let offset = 0; offset < rows.length; offset += 500) {
      const { error } = await db.from("channel_jobs").insert(rows.slice(offset, offset + 500));
      if (error) throw new Error(error.message);
    }
  };

  // Mimics the after-webhook REALTIME drain kick (see `workerUrl`). Failures are ignored: pg_cron is still the backstop.
  const kickWorkers = async () => {
    if (!workerUrl || !cronSecret) return;
    while (!stop) {
      await fetch(`${workerUrl}/api/cron/inbox-lanes?lane=REALTIME`, { headers: { authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(58_000) }).catch(() => undefined);
      await sleep(KICK_INTERVAL_MS);
    }
  };

  // How long the OLDEST waiting job has been waiting, sampled through the run: the alerting signal §11 names.
  const sampleQueueAge = async () => {
    while (!stop) {
      const { data } = await db.from("channel_jobs").select("created_at").eq("status", "QUEUED").contains("payload", { loadRunId: runId }).order("created_at").limit(1);
      const oldest = (data ?? [])[0] as { created_at: string } | undefined;
      queueAgeSamplesMs.push(oldest ? Date.now() - new Date(oldest.created_at).getTime() : 0);
      await sleep(QUEUE_AGE_SAMPLE_MS);
    }
  };

  const fetchJobs = async (): Promise<JobRow[]> => {
    // Paged: the API returns at most 1,000 rows per request, so a single select silently sees a slice of the run.
    const pages: JobRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("channel_jobs").select("id,agency_id,status,created_at,updated_at,last_error").contains("payload", { loadRunId: runId }).order("id").range(from, from + 999);
      if (error) throw new Error(error.message);
      pages.push(...((data ?? []) as JobRow[]));
      if ((data ?? []).length < 1000) break;
    }
    return pages;
  };

  let jobs: JobRow[] = [];
  try {
    const background = [kickWorkers(), sampleQueueAge()];

    // ── Injection: one batch per second, on the clock, so the rate is the profile's rate and not "as fast as possible".
    const schedule = planInjectionSchedule(shape);
    for (let second = 0; second < schedule.length; second += 1) {
      const dueAt = startedAt + second * 1000;
      if (dueAt > Date.now()) await sleep(dueAt - Date.now());
      if (schedule[second] > 0) await injectSecond(schedule[second]);
      if (second % 15 === 0) console.log(`t+${second}s created=${created}/${plannedJobs}`);
    }
    injectionFinishedAt = Date.now();

    // ── Drain: wait for the workers to finish whatever backlog remains.
    while (Date.now() - injectionFinishedAt < DRAIN_TIMEOUT_MS) {
      jobs = await fetchJobs();
      const tally = jobs.reduce<Record<string, number>>((counts, job) => ({ ...counts, [job.status]: (counts[job.status] ?? 0) + 1 }), {});
      console.log(`t+${Math.round((Date.now() - startedAt) / 1000)}s jobs=${jobs.length}/${plannedJobs} ${JSON.stringify(tally)}`);
      if (jobs.length === plannedJobs && jobs.every((job) => ["DONE", "FAILED", "DEAD"].includes(job.status))) break;
      await sleep(POLL_MS * 4);
    }
    jobs = await fetchJobs();
    stop = true;
    await Promise.allSettled(background);

    const done = jobs.filter((job) => job.status === "DONE");
    const timings = done.map((job) => ({ agencyId: job.agency_id, latencyMs: new Date(job.updated_at).getTime() - new Date(job.created_at).getTime() }));
    const overall = summarizeLatencies(timings.map((timing) => timing.latencyMs));
    const cohorts = summarizeNoisyNeighbour(timings, noisyAgencyId);
    const firstCreatedMs = jobs.length === 0 ? startedAt : Math.min(...jobs.map((job) => new Date(job.created_at).getTime()));
    const lastFinishedMs = done.length === 0 ? startedAt : Math.max(...done.map((job) => new Date(job.updated_at).getTime()));
    const failureReasons = jobs.filter((job) => job.status === "DEAD" || job.status === "FAILED").reduce<Record<string, number>>((counts, job) => {
      const reason = (job.last_error ?? "unknown").slice(0, 140);
      return { ...counts, [reason]: (counts[reason] ?? 0) + 1 };
    }, {});

    const allConversationIds = [...conversationsByAgency.values()].flat();
    // Chunked: thousands of ids in one `in (...)` filter overflow the request URL (HTTP 414 from the API gateway).
    const runs: Array<{ subject_id: unknown; cost_usd: unknown }> = [];
    for (let offset = 0; offset < allConversationIds.length; offset += 150) {
      const { data, error: runsError } = await db.from("ai_runs").select("subject_id,cost_usd").eq("subject_type", "CONVERSATION").in("subject_id", allConversationIds.slice(offset, offset + 150)).gte("created_at", new Date(startedAt).toISOString());
      if (runsError) throw new Error(runsError.message);
      runs.push(...(data ?? []));
    }
    const modelConversationCount = new Set(runs.map((run) => String(run.subject_id))).size;
    const totalCostUsd = runs.reduce((sum, run) => sum + Number(run.cost_usd ?? 0), 0);
    const s0SkipRate = done.length === 0 ? 0 : 1 - modelConversationCount / Math.max(done.length, 1);
    const costPerEnrichedConversation = done.length === 0 ? Number.POSITIVE_INFINITY : totalCostUsd / done.length;

    const report = {
      runId,
      profile: options.profile,
      workerKick: Boolean(workerUrl && cronSecret),
      agencies: AGENCIES,
      plannedJobs,
      createdJobs: created,
      completed: done.length,
      notCompleted: jobs.length - done.length,
      deadLetterRate: jobs.length === 0 ? 0 : jobs.filter((job) => job.status === "DEAD").length / jobs.length,
      failureReasons,
      throughputJobsPerSecond: throughputPerSecond(done.length, firstCreatedMs, lastFinishedMs),
      realtimeEndToEnd: overall,
      queueAge: { samples: queueAgeSamplesMs.length, p95Ms: summarizeLatencies(queueAgeSamplesMs).p95Ms, maxMs: Math.max(0, ...queueAgeSamplesMs), over10sSamples: queueAgeSamplesMs.filter((age) => age > 10_000).length },
      backlogClearedAfterInjectionMs: injectionFinishedAt === null ? null : Math.max(0, lastFinishedMs - injectionFinishedAt),
      noisyNeighbour: options.profile === "noisy-tenant" ? cohorts : undefined,
      controlAgencySpread: cohorts.controlSpread,
      s0SkipRate,
      costPerEnrichedConversation,
    };
    console.log(JSON.stringify(report, null, 2));
    if (options.reportPath) writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    // Baseline keeps its original bar; the rate profiles use the §11.3 queue SLOs.
    const passed = options.profile === "baseline"
      ? done.length === plannedJobs && overall.p95Ms < 30_000 && s0SkipRate >= 0.5 && costPerEnrichedConversation <= 0.012 && cohorts.controlSpread <= 0.2
      : done.length === plannedJobs && overall.p95Ms < 5_000 && report.deadLetterRate < 0.001 && cohorts.controlSpread <= 0.2;
    if (!passed) process.exitCode = 1;
  } finally {
    stop = true;
    await db.from("channel_jobs").delete().contains("payload", { loadRunId: runId });
    if (fixtureAgencyIds.length > 0) await removeInboxLoadFixtures(db, fixtureAgencyIds);
  }
}

// The fixture code writes to tables that are not in the generated database types, so it takes an untyped client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LoadFixtureDatabase = SupabaseClient<any>;

async function seedInboxLoadFixtures(db: LoadFixtureDatabase): Promise<string[]> {
  const now = new Date().toISOString();
  const agencies = Array.from({ length: AGENCIES }, (_, index) => ({
    name: `Inbox load fixture ${index + 1}`,
    slug: `inbox-load-${runId}-${index + 1}`,
    status: "ACTIVE",
  }));
  const { data: createdAgencies, error: agenciesError } = await db.from("agencies").insert(agencies).select("id");
  if (agenciesError || !createdAgencies || createdAgencies.length !== AGENCIES) throw new Error(agenciesError?.message ?? "Could not create Inbox load agencies.");
  const createdAgencyIds = createdAgencies.map((agency) => String(agency.id));

  try {
    const { data: connections, error: connectionsError } = await db.from("channel_connections").insert(createdAgencyIds.map((agencyId, index) => ({
      agency_id: agencyId,
      provider: "OTHER",
      provider_account_id: `inbox-load-${runId}-${index + 1}`,
      display_name: "Inbox load fixture",
      status: "NOT_CONNECTED",
    }))).select("id,agency_id");
    if (connectionsError || !connections || connections.length !== AGENCIES) throw new Error(connectionsError?.message ?? "Could not create Inbox load connections.");
    const connectionByAgency = new Map(connections.map((connection) => [String(connection.agency_id), String(connection.id)]));
    const conversations = createdAgencyIds.flatMap((agencyId, agencyIndex) => Array.from({ length: CONVERSATIONS_PER_AGENCY }, (_, conversationIndex) => ({
      agency_id: agencyId,
      channel: "OTHER",
      connection_id: connectionByAgency.get(agencyId),
      external_conversation_id: `inbox-load-${runId}-${agencyIndex + 1}-${conversationIndex + 1}`,
      external_thread_id: `inbox-load-${runId}-${agencyIndex + 1}-${conversationIndex + 1}`,
      contact_name: "Inbox load fixture",
      contact_phone: "",
      state: "HUMAN_ACTIVE",
      ai_enabled: false,
      lifecycle_status: "OPEN",
      handling_mode: "HUMAN_ACTIVE",
      last_activity_at: now,
      last_message_preview: "Inbox load fixture",
    })));
    for (let offset = 0; offset < conversations.length; offset += 500) {
      const { error } = await db.from("conversations").insert(conversations.slice(offset, offset + 500));
      if (error) throw new Error(error.message);
    }
    return createdAgencyIds;
  } catch (error) {
    await removeInboxLoadFixtures(db, createdAgencyIds);
    throw error;
  }
}

async function removeInboxLoadFixtures(db: LoadFixtureDatabase, fixtureAgencyIds: string[]): Promise<void> {
  // In small batches: every deleted conversation fires cascading deletes and queue/realtime triggers, so removing ten
  // thousand in ONE statement exceeds the database's statement timeout and leaves the fixtures behind.
  for (;;) {
    const { data: batch, error: selectError } = await db.from("conversations").select("id").in("agency_id", fixtureAgencyIds).limit(300);
    if (selectError) throw new Error(`Could not list Inbox load conversations: ${selectError.message}`);
    if (!batch || batch.length === 0) break;
    const { error: conversationsError } = await db.from("conversations").delete().in("id", batch.map((row) => String(row.id)));
    if (conversationsError) throw new Error(`Could not remove Inbox load conversations: ${conversationsError.message}`);
  }
  const { error: connectionsError } = await db.from("channel_connections").delete().in("agency_id", fixtureAgencyIds);
  if (connectionsError) throw new Error(`Could not remove Inbox load connections: ${connectionsError.message}`);
  const { error: agenciesError } = await db.from("agencies").delete().in("id", fixtureAgencyIds);
  if (agenciesError) throw new Error(`Could not remove Inbox load agencies: ${agenciesError.message}`);
}
