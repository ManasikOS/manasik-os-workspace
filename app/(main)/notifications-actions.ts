"use server";

/**
 * The header bar's notification bell — mark-read actions. Reading the list
 * itself happens server-side in `(main)/layout.tsx` (it needs to render on
 * first paint, not pop in after a client fetch); this file is only the two
 * writes a click can trigger. Runs under the signed-in user's own session —
 * `staff_notifications`' RLS (`recipient_id = auth.uid()`) is the actual
 * enforcement, exactly like every other action in this codebase treats its
 * table's RLS as the real gate and the session client as the natural way to
 * respect it.
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { requireUser } from "@/lib/dal";
import { createClient } from "@/utils/supabase/server";

export async function markNotificationReadAction(notificationId: string): Promise<void> {
  await requireUser();
  const supabase = createClient(await cookies());
  await supabase
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .is("read_at", null);
  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  const supabase = createClient(await cookies());
  await supabase
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);
  revalidatePath("/", "layout");
}
