import { checkCron, checkIsolation, checkMigrations, checkSchemaFingerprint, checkStorage } from "./evaluate";
import { checkConfiguration, checkLiveness, checkRollback, checkWebhookSecurity, checkWorker } from "./http-checks";
import type { GateCheckResult, GateContext, GateSnapshot } from "./types";

/** Checks the gate lists but does not perform yet. Each is PENDING with its reason, so the gate can never pass while one is unbuilt. */
export const NOT_BUILT_YET: GateCheckResult[] = [
  { id: "G9", title: "Disposable-agency acceptance", status: "PENDING", detail: "Not built yet (TASK-032 S7b, after the browser specs of S6): a test agency receives a signed webhook, keeps one copy of a duplicate, and is removed with nothing left behind." },
  { id: "G10", title: "Sentry received", status: "PENDING", detail: "Not built yet (TASK-032 S8): a gate test event must reach Sentry tagged for this environment." },
  { id: "G11", title: "Sentry alerts", status: "PENDING", detail: "Not built yet (TASK-032 S8): the five alert rules and the inbox-health cron monitor must exist and be enabled." },
  { id: "G12", title: "Meta live", status: "PENDING", detail: "Not built yet (TASK-032 S8): the Meta app must be live with the permissions each channel needs." },
  { id: "G14", title: "Alert delivery", status: "PENDING", detail: "Not built yet (TASK-032 S8): the on-call channel must have received the gate's test alert." },
];

async function guarded(id: string, title: string, run: () => Promise<GateCheckResult>): Promise<GateCheckResult> {
  try {
    return await run();
  } catch (cause) {
    return { id, title, status: "FAIL", detail: `The check itself failed: ${cause instanceof Error ? cause.message.slice(0, 160) : "unknown error"}.` };
  }
}

const ORDER = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "G13", "G14", "G15"];

/** Runs every check. Never throws: a check that cannot run is a FAIL with the reason, and the rest still run. */
export async function runGate(context: GateContext): Promise<GateCheckResult[]> {
  const now = context.now ?? new Date();

  let snapshot: GateSnapshot | null = null;
  let snapshotError = "";
  try {
    snapshot = await context.readSnapshot();
  } catch (cause) {
    snapshotError = cause instanceof Error ? cause.message.slice(0, 160) : "unknown error";
  }
  const fromSnapshot = (id: string, title: string, run: (snapshot: GateSnapshot) => GateCheckResult) =>
    guarded(id, title, async () => (snapshot ? run(snapshot) : { id, title, status: "FAIL" as const, detail: `The database snapshot could not be read: ${snapshotError}.` }));

  const results = await Promise.all([
    guarded("G1", "Liveness and build", () => checkLiveness(context)),
    fromSnapshot("G2", "Migrations", (s) => checkMigrations(context.repoMigrationFiles, s)),
    fromSnapshot("G3", "Tenant isolation", checkIsolation),
    fromSnapshot("G4", "Scheduled jobs", (s) => checkCron(s, now)),
    fromSnapshot("G5", "Storage", checkStorage),
    guarded("G6", "Configuration", () => checkConfiguration(context)),
    guarded("G15", "Schema matches the repository", async () => {
      if (!context.readSchemaFingerprint || !context.schemaBaseline) {
        return { id: "G15", title: "Schema matches the repository", status: "PENDING", detail: "No schema baseline or fingerprint reader was supplied, so the schema was not compared." };
      }
      const baseline = context.schemaBaseline;
      let live;
      try {
        live = await context.readSchemaFingerprint();
      } catch (cause) {
        return { id: "G15", title: "Schema matches the repository", status: "FAIL", detail: `The schema fingerprint could not be read (apply 20270109090000_gate_schema_fingerprint.sql): ${cause instanceof Error ? cause.message.slice(0, 160) : "unknown error"}.` };
      }
      return checkSchemaFingerprint(baseline, live, context.repoMigrationFiles);
    }),
    guarded("G7", "Worker", () => checkWorker(context)),
    guarded("G8", "Webhook security", () => checkWebhookSecurity(context)),
    guarded("G13", "Rollback", () => checkRollback(context)),
  ]);

  return [...results, ...NOT_BUILT_YET].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}
