import { z } from "zod";

import { SUGGESTED_VAULT_CATEGORIES } from "@/lib/types/vault";

/**
 * A category is free text (see the migration's comment on why), but two
 * people typing "passport", "Passport" and "PASSPORT" on separate uploads
 * must land on the same tab, not three. Anything matching a suggested
 * category case-insensitively snaps to that category's canonical casing;
 * anything else is trimmed/whitespace-collapsed and title-cased as typed.
 */
export function normalizeVaultCategoryLabel(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const suggested = SUGGESTED_VAULT_CATEGORIES.find((c) => c.toLowerCase() === collapsed.toLowerCase());
  if (suggested) return suggested;
  return collapsed
    .split(" ")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(" ");
}

export const vaultCategorySchema = z
  .string()
  .trim()
  .min(1, "Choose a category.")
  .max(60, "Category names are shorter than that.")
  .transform(normalizeVaultCategoryLabel);

export const requestVaultUploadUrlSchema = z.object({
  category: vaultCategorySchema,
  filename: z.string().min(1, "Choose a file.").max(255, "That file name is too long."),
  mimeType: z.string().min(1).max(200),
  byteSize: z.number().int().positive("That file is empty."),
});

export const confirmVaultUploadSchema = z.object({
  category: vaultCategorySchema,
  title: z.string().trim().min(1, "Give the document a title.").max(200, "Titles are shorter than that."),
  path: z.string().min(1).max(300),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(200),
});

export const listVaultDocumentsSchema = z.object({
  category: vaultCategorySchema.optional(),
});

export const deleteVaultDocumentSchema = z.object({
  id: z.string().uuid(),
});

export const getVaultDocumentUrlSchema = z.object({
  id: z.string().uuid(),
});

export const saveInboxMediaToVaultSchema = z
  .object({
    attachmentId: z.string().uuid(),
    destination: z.enum(["PROPOSAL_COLLATERAL", "DOCUMENTS"]),
  })
  .strict();

export const createDepartureGroupBrochureInputSchema = z.object({
  departureGroupId: z.string().uuid(),
});
export type CreateDepartureGroupBrochureInput = z.infer<typeof createDepartureGroupBrochureInputSchema>;

/** Stages an already-uploaded vault document into a conversation's outbound path — a real send follows through the composer's normal attachment flow, not this call. */
export const stageVaultDocumentInputSchema = z.object({
  conversationId: z.string().uuid(),
  vaultDocumentId: z.string().uuid(),
});
export type StageVaultDocumentInput = z.infer<typeof stageVaultDocumentInputSchema>;
