/**
 * Opt-in server-side timing for performance work (docs/tasks/TASK-004).
 *
 * Off unless `PERF_TIMING=1`, so it costs one boolean check in normal use. When
 * on, each wrapped call logs one line — `[perf] <label> <ms>ms` — that is easy
 * to grep in `next dev` output or search in Vercel runtime logs
 * (`get_runtime_logs` with query "[perf]").
 */
const isTimingEnabled = process.env.PERF_TIMING === "1";

export async function withTiming<T>(label: string, run: () => Promise<T>): Promise<T> {
  if (!isTimingEnabled) return run();

  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    console.info(`[perf] ${label} ${Math.round(performance.now() - startedAt)}ms`);
  }
}
