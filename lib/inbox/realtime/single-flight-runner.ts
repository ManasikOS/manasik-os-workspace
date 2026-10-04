/**
 * Runs one asynchronous read at a time and folds everything that arrives meanwhile into ONE queued follow-up.
 *
 * Why: the thread and note reads carry no version, so two of them in flight at once could complete in the wrong order and
 * let an older snapshot overwrite a newer delivery status — and a read that is dropped as "superseded" would silently lose
 * the specific ids it was asked to reload. Serialising them removes both problems: nothing is ever dropped (a request that
 * arrives while one is running is merged into the queued plan), and no two snapshots race.
 *
 * Nothing here knows about the Inbox; `merge` decides how two plans combine.
 */
export interface SingleFlightRunner<TPlan> {
  /** Run now if idle, otherwise merge into the queued follow-up. */
  submit(plan: TPlan): void;
  /** Forget the queued follow-up (e.g. the person switched conversations). A read already running finishes on its own. */
  cancelQueued(): void;
  /** True while a read is running or queued. */
  busy(): boolean;
}

export function createSingleFlightRunner<TPlan>(
  run: (plan: TPlan) => Promise<void>,
  merge: (queued: TPlan, incoming: TPlan) => TPlan,
  onError: (cause: unknown) => void = () => undefined,
): SingleFlightRunner<TPlan> {
  let running = false;
  let queued: { plan: TPlan } | null = null;

  const start = async (plan: TPlan): Promise<void> => {
    running = true;
    try {
      await run(plan);
    } catch (cause) {
      onError(cause);
    } finally {
      running = false;
    }
    if (queued) {
      const next = queued.plan;
      queued = null;
      await start(next);
    }
  };

  return {
    submit(plan) {
      if (running) {
        queued = { plan: queued ? merge(queued.plan, plan) : plan };
        return;
      }
      void start(plan);
    },
    cancelQueued() {
      queued = null;
    },
    busy() {
      return running || queued !== null;
    },
  };
}
