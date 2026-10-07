"use server";

import { cookies } from "next/headers";

import { requireUser } from "@/lib/dal";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { searchEverythingForStaff } from "@/lib/data/global-search-repository";
import { buildGlobalSearchPattern, isGlobalSearchPatternEmpty } from "@/lib/search/global-search-term";
import type { GlobalSearchResult } from "@/lib/search/global-search-types";
import { globalSearchInputSchema } from "@/lib/validations/global-search";
import { createClient } from "@/utils/supabase/server";

/** Finds records across the agency's modules that match what was typed in the header search. */
export async function searchEverythingInHeaderAction(
  rawInput: unknown,
): Promise<GlobalSearchResult> {
  await requireUser();

  const parsed = globalSearchInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: "Type at least 2 characters to search." };
  }

  const pattern = buildGlobalSearchPattern(parsed.data.query);
  if (isGlobalSearchPatternEmpty(pattern)) return { ok: true, data: [] };

  const { role } = await getCurrentStaffRole();
  const supabase = createClient(await cookies());
  const hits = await searchEverythingForStaff(supabase, role, pattern);
  return { ok: true, data: hits };
}
