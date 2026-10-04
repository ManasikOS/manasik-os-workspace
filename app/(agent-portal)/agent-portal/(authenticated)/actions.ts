"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getPortalAgentSession } from "@/lib/data/agent-portal-auth";
import { createAgentSubmission } from "@/lib/data/agent-portal-repository";
import { createClient } from "@/utils/supabase/server";

interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function signOutAgentPortalAction(): Promise<void> {
  const supabase = createClient(await cookies());
  await supabase.auth.signOut();
  redirect("/agent-portal/login");
}

/**
 * The one write an agent gets directly, from their own portal — submitting
 * a new prospect against a package they're allocated. RLS's "agent create
 * own submissions" policy (20261030090000_agent_portal_auth.sql) enforces
 * sales_agent_id matches their own session; everything else about the
 * submission (status, conversion) stays a staff-only update in the CRM.
 */
export async function submitAgentProspectAction(input: {
  packageId: string | null;
  leadName: string;
  leadContact: string | null;
  notes: string | null;
}): Promise<ActionResult> {
  const supabase = createClient(await cookies());
  const session = await getPortalAgentSession(supabase);
  if (!session) return { ok: false, error: "Your session could not be found." };
  if (!input.leadName.trim()) return { ok: false, error: "Enter who you're bringing in." };

  await createAgentSubmission(supabase, {
    salesAgentId: session.id,
    packageId: input.packageId,
    leadName: input.leadName,
    leadContact: input.leadContact,
    notes: input.notes,
    submittedByName: session.name,
  });

  revalidatePath("/agent-portal");
  return { ok: true };
}
