"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { saveDraftAction, savePackagePatchAction } from "../actions";
import type { PackageFormData } from "./types";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error" | "stale";

/** What a single flush actually did — returned by `saveNow()` so a caller can react honestly instead of assuming success (finding E3). */
export type FlushOutcome =
  | { ok: true }
  | { ok: false; code?: "STALE"; error?: string; step?: number };

interface UseDraftAutosaveOptions {
  formData: PackageFormData;
  /** Existing row id when resuming a draft; null for a fresh wizard session. */
  initialPackageId: string | null;
  /** `updated_at` of the row as loaded, for the very first patch's staleness check. */
  initialUpdatedAt?: string | null;
  /** Idle time before an edit is flushed. */
  delay?: number;
  /** Fired the first time a row is created, so the URL can pick up the id. */
  onPackageCreated?: (packageId: string) => void;
}

/**
 * Draft autosave for the package wizard.
 *
 * Saves on three triggers: `delay`ms after typing stops, on demand via
 * `saveNow()` (used for step changes and the "Back to Packages" button), and
 * best-effort when the tab is hidden or unloaded.
 *
 * The very first save for a brand-new session has no row yet, so it always
 * goes through `saveDraftAction` (a full insert). Every save after that
 * diffs the current form against the last snapshot this hook actually wrote
 * and sends only the changed keys through `savePackagePatchAction` — the
 * server then writes only the columns whose value actually changed, instead
 * of rewriting all ~120 columns on every 2-second flush.
 *
 * Every write goes through a single promise chain. That matters because the
 * first save has no row id yet — without serialising, two overlapping saves
 * would each insert and the wizard would silently fork into two draft rows.
 */
export function useDraftAutosave({
  formData,
  initialPackageId,
  initialUpdatedAt = null,
  delay = 2000,
  onPackageCreated,
}: UseDraftAutosaveOptions) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(
    initialUpdatedAt ? new Date(initialUpdatedAt) : null,
  );
  const [packageId, setPackageId] = useState<string | null>(initialPackageId);
  /** Why the last save failed, for the "Could not save" label. Cleared by the next success. */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const latestForm = useRef(formData);
  const packageIdRef = useRef(initialPackageId);
  const lastSavedFormRef = useRef(formData);
  const lastSavedAtIsoRef = useRef<string | null>(initialUpdatedAt);
  const isDirty = useRef(false);
  const queue = useRef<Promise<FlushOutcome>>(Promise.resolve({ ok: true }));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCreated = useRef(onPackageCreated);

  // Synced after render (never during it) so the queued save always reads the
  // newest form state. Declared before the debounce effect below so it has
  // already run by the time that one schedules a flush.
  useEffect(() => {
    latestForm.current = formData;
    onCreated.current = onPackageCreated;
  });

  /** Keys whose value differs between two form snapshots (shallow, per top-level field). */
  const diffKeys = (before: PackageFormData, after: PackageFormData) => {
    const keys = new Set<keyof PackageFormData>();
    for (const key of Object.keys(after) as (keyof PackageFormData)[]) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) keys.add(key);
    }
    return keys;
  };

  /** Queued so saves never overlap; resolves with what this save actually did once it completes. */
  const flush = useCallback((): Promise<FlushOutcome> => {
    queue.current = queue.current.then(async (): Promise<FlushOutcome> => {
      if (!isDirty.current) return { ok: true };

      const snapshot = latestForm.current;
      // Cleared before awaiting: edits made *during* the save re-mark the form
      // dirty and get picked up by the next flush.
      isDirty.current = false;
      setStatus("saving");

      try {
        if (!packageIdRef.current) {
          // No row yet — this must be a full create, there is nothing to patch.
          const result = await saveDraftAction({
            packageId: null,
            form: snapshot,
          });

          if (!result.ok) {
            isDirty.current = true;
            setStatus("error");
            setErrorMessage(result.error);
            return { ok: false, code: result.code, error: result.error, step: result.step };
          }

          setErrorMessage(null);
          packageIdRef.current = result.packageId;
          setPackageId(result.packageId);
          lastSavedFormRef.current = snapshot;
          lastSavedAtIsoRef.current = result.savedAt;
          setLastSavedAt(new Date(result.savedAt));
          setStatus("saved");
          onCreated.current?.(result.packageId);
          return { ok: true };
        }

        const changedKeys = diffKeys(lastSavedFormRef.current, snapshot);
        if (changedKeys.size === 0) {
          setStatus("saved");
          return { ok: true };
        }

        const patch: Partial<PackageFormData> = {};
        for (const key of changedKeys) {
          (patch as Record<string, unknown>)[key] = snapshot[key];
        }

        const result = await savePackagePatchAction({
          packageId: packageIdRef.current,
          patch,
          expectedUpdatedAt: lastSavedAtIsoRef.current ?? undefined,
        });

        if (!result.ok) {
          if (result.code === "STALE") {
            // Another tab has written to this draft since this one last saw
            // it — stop retrying blindly (that would just hit STALE again)
            // and surface it so the wizard can prompt a reload.
            setStatus("stale");
            return { ok: false, code: "STALE", error: result.error };
          }
          isDirty.current = true;
          setStatus("error");
          setErrorMessage(result.error);
          return { ok: false, error: result.error, step: result.step };
        }

        setErrorMessage(null);
        lastSavedFormRef.current = snapshot;
        lastSavedAtIsoRef.current = result.savedAt;
        setLastSavedAt(new Date(result.savedAt));
        setStatus("saved");
        return { ok: true };
      } catch {
        // Network drop or a rotated action id — keep the edit pending.
        isDirty.current = true;
        setStatus("error");
        const unreachable = "Could not reach the server. Check your connection and try again.";
        setErrorMessage(unreachable);
        return { ok: false, error: unreachable };
      }
    });

    return queue.current;
  }, []);

  /**
   * Flush immediately, cancelling any pending debounce.
   *
   * Resolves with the row id and its `updated_at` *after* the write
   * settles. Callers must use the id rather than the `packageId` captured
   * in their render closure: when this flush is the one that creates the
   * row, that closure still holds the pre-creation `null`, and publishing
   * with it would insert a second row. `updatedAt` is handed to
   * `publishPackageAction` as `expectedUpdatedAt` so a publish that follows
   * this save gets the same compare-and-swap protection every other
   * lifecycle write has — it must come from here (the value this hook
   * itself last saw written) rather than being reconstructed from the
   * `lastSavedAt` Date state, whose `.toISOString()` is not guaranteed to
   * byte-for-byte match the string Postgres returned.
   *
   * Also carries `ok`/`code` — the actual outcome of this flush — so a
   * caller (Save Draft, Leave, Publish) can react honestly instead of
   * assuming success the way this always used to (finding E3).
   */
  const saveNow = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const outcome = await flush();
    return {
      packageId: packageIdRef.current,
      updatedAt: lastSavedAtIsoRef.current,
      ...outcome,
    };
  }, [flush]);

  // Debounced save. The mount run is skipped so simply opening the wizard
  // does not create an empty draft row.
  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    isDirty.current = true;
    setStatus((current) => (current === "saving" ? current : "idle"));

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, delay);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [formData, delay, flush]);

  // Best-effort save when the tab is backgrounded or closed. `pagehide` and
  // `visibilitychange` fire reliably on mobile where `beforeunload` does not.
  useEffect(() => {
    const saveOnExit = () => {
      if (isDirty.current) void flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saveOnExit();
    };

    window.addEventListener("pagehide", saveOnExit);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", saveOnExit);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  return {
    status,
    errorMessage,
    lastSavedAt,
    packageId,
    saveNow,
    /** True when there are edits not yet written. */
    get hasPendingChanges() {
      return isDirty.current;
    },
  };
}
