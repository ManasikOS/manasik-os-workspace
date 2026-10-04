"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import {
  upsertServiceAddon,
  toggleAddonActive,
  deleteServiceAddon,
  type UpsertAddonInput,
} from "@/lib/data/service-addons";

export async function upsertServiceAddonAction(input: UpsertAddonInput) {
  const supabase = createClient(await cookies());
  const result = await upsertServiceAddon(supabase, input);
  if (result.ok) revalidatePath("/management/settings/service-addons");
  return result;
}

export async function toggleAddonActiveAction(id: string, active: boolean) {
  const supabase = createClient(await cookies());
  const result = await toggleAddonActive(supabase, id, active);
  if (result.ok) revalidatePath("/management/settings/service-addons");
  return result;
}

export async function deleteServiceAddonAction(id: string) {
  const supabase = createClient(await cookies());
  const result = await deleteServiceAddon(supabase, id);
  if (result.ok) revalidatePath("/management/settings/service-addons");
  return result;
}
