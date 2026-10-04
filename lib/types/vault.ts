/**
 * Row type for the Document Vault's `vault_documents` (supersedes
 * `content_items` — see `supabase/migrations/20261211090000_vault_documents.sql`).
 * Every field is required: a vault document is always a real uploaded file,
 * never a draft or a bare external link.
 */

export interface VaultDocumentRow {
  id: string;
  category: string;
  title: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  source_departure_group_id: string | null;
  uploaded_by_name: string;
  created_at: string;
  updated_at: string;
}

/** Shown as tabs in the Vault dialog. Typing any other category on upload works too — this is a starting point, not a closed set. */
export const SUGGESTED_VAULT_CATEGORIES = [
  "Passport",
  "Visa",
  "Flight Ticket",
  "Brochure",
  "Receipt",
  "Other",
] as const;
