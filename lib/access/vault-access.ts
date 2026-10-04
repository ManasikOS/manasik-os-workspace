import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Document Vault (`vault_documents`, supersedes
 * `content-vault-access.ts`'s marketing-only gate). Passports, visas,
 * tickets and receipts are handled by Operations/Visa/Finance day to day,
 * not just Marketing — this must match `vault_documents`' own RLS write
 * policy exactly (`supabase/migrations/20261211090000_vault_documents.sql`),
 * or a role sees a control that fails at the database instead of a clean
 * "you can't do this."
 *
 * Reading the vault (browsing/downloading/attaching to a chat) has no
 * capability gate here — RLS already scopes reads to "any authenticated
 * staff in the agency," and every role needs to be able to pull up, say, a
 * pilgrim's passport scan from the vault regardless of who uploaded it.
 */

export interface VaultCapabilities {
  /** Upload, delete, or generate (e.g. a departure-group brochure) into the vault. */
  manageVault: boolean;
}

const VAULT_WRITE_ROLES: ReadonlySet<StaffRole> = new Set(["ADMIN", "CEO", "OPERATIONS", "VISA", "FINANCE", "MARKETING"]);

export function capabilitiesForVault(role: StaffRole): VaultCapabilities {
  return { manageVault: VAULT_WRITE_ROLES.has(role) };
}
