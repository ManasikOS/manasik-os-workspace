import { z } from "zod";

export const GLOBAL_SEARCH_MIN_CHARS = 2;
export const GLOBAL_SEARCH_MAX_CHARS = 80;

export const globalSearchInputSchema = z.object({
  query: z.string().trim().min(GLOBAL_SEARCH_MIN_CHARS).max(GLOBAL_SEARCH_MAX_CHARS),
});

export type GlobalSearchInput = z.infer<typeof globalSearchInputSchema>;
