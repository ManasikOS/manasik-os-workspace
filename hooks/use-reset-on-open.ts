import { useState } from "react";

/**
 * Re-seeds a dialog's form state each time it opens.
 *
 * Dialogs and sheets in this app stay mounted while closed so they can animate,
 * which means `useState(entity?.field ?? "")` only ever runs once — usually with
 * no entity at all, because the parent mounts the dialog with `null` and only
 * names the row when the operator clicks Edit. Every field would then open
 * blank, and saving would write those blanks over the record.
 *
 * The reset runs during render rather than in an effect, which is React's
 * documented way to adjust state when a prop changes: the component re-renders
 * with the new values before anything is committed, so the operator never sees
 * a frame of the previous row's data.
 *
 * `key` identifies *what* is being edited — an id, not the object. Re-syncing on
 * object identity would discard whatever the operator had typed every time a
 * background `router.refresh()` handed down a new instance of the same record.
 *
 * @param open  Whether the dialog is currently open.
 * @param key   Stable identity of the record being edited ("" when adding).
 * @param reset Seeds every field from the record. Called once per open.
 */
export function useResetOnOpen(
  open: boolean,
  key: string,
  reset: () => void,
): void {
  const [syncedOn, setSyncedOn] = useState<string | null>(null);
  const token = open ? key : null;

  if (token !== syncedOn) {
    setSyncedOn(token);
    if (open) reset();
  }
}
