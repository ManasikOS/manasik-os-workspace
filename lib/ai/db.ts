/**
 * The generic Supabase client type shared by every file under `lib/ai/*`.
 * Same `SupabaseClient<any, any, any>` shape every `lib/data/*-repository.ts`
 * file already uses — pulled out here so `lib/ai/provider.ts`,
 * `lib/ai/telemetry.ts` and `lib/ai/budget.ts` (Phase 0's P0.1) don't need
 * to import from `lib/agent/kernel/proposals/*` (P0.2), which would create
 * a dependency in the wrong direction between the two slices.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Db = SupabaseClient<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
