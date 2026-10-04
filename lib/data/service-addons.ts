import type { SupabaseClient } from "@supabase/supabase-js";

export interface ServiceAddonRow {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  default_amount: number | null;
  currency: string;
  unit: string;
  creates_deviation: boolean;
  journey_types: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertAddonInput {
  id?: string;
  code: string;
  name: string;
  description?: string;
  category: string;
  defaultAmount: number | null;
  currency?: string;
  unit: string;
  createsDeviation: boolean;
  journeyTypes: string[];
  active?: boolean;
}

export async function listServiceAddons(
  supabase: SupabaseClient,
): Promise<ServiceAddonRow[]> {
  const { data, error } = await supabase
    .from("agency_service_addons")
    .select("*")
    .order("category")
    .order("name");

  if (error) throw error;
  return (data ?? []) as ServiceAddonRow[];
}

export async function upsertServiceAddon(
  supabase: SupabaseClient,
  input: UpsertAddonInput,
): Promise<{ ok: true; addon: ServiceAddonRow } | { ok: false; error: string }> {
  const payload = {
    code: input.code.toUpperCase().replace(/\s+/g, "_"),
    name: input.name,
    description: input.description ?? "",
    category: input.category,
    default_amount: input.defaultAmount,
    currency: input.currency ?? "LKR",
    unit: input.unit,
    creates_deviation: input.createsDeviation,
    journey_types: input.journeyTypes,
    active: input.active ?? true,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("agency_service_addons")
      .update(payload)
      .eq("id", input.id)
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, addon: data as ServiceAddonRow };
  }

  const { data, error } = await supabase
    .from("agency_service_addons")
    .insert(payload)
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `An add-on with code "${payload.code}" already exists.` };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, addon: data as ServiceAddonRow };
}

export async function toggleAddonActive(
  supabase: SupabaseClient,
  id: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("agency_service_addons")
    .update({ active })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteServiceAddon(
  supabase: SupabaseClient,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("agency_service_addons")
    .delete()
    .eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "This add-on is referenced by existing charges and cannot be deleted. Deactivate it instead." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
