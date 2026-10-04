/**
 * Constants and types shared between the server-only
 * `lib/data/role-permissions-repository.ts` and client components (the
 * Roles & Permissions editor). Deliberately has NO `import "server-only"` —
 * that guard is exactly what broke importing `BASE_ROLES` from a Client
 * Component: any real (non-type) import from a server-only-guarded module
 * pulls the whole module into the client bundle, and `server-only` throws
 * there by design. Pure constants/types have no reason to carry that guard,
 * so they live here instead; the repository re-exports them for the server
 * side's existing imports.
 */

export const KNOWN_MODULES = [
  "departure_groups",
  "documents",
  "finance",
  "leads",
  "operations",
  "packages",
  "pilgrims",
  "reports",
  "settings",
  "suppliers",
  "visa",
  "team",
  "ai_agent",
  "inbox",
  // Added in Phase 0 (P0.3) — docs/modules/manasik-intelligence-build-roadmap.md.
  // `marketing`'s access file (lib/access/marketing-access.ts) already
  // existed for Campaigns but was never registered here (F5 in
  // docs/modules/manasik-intelligence-implementation-plan.md §1.3); the other nine
  // are genuinely new modules per docs/architecture/remaining-modules-master-plan.md §6.
  "marketing",
  "bookings",
  "quotes",
  "field_ops",
  "guides",
  "support",
  "relationships",
  "agents",
  "analytics",
  "insights",
] as const;

export type PermissionModule = (typeof KNOWN_MODULES)[number];

export const BASE_ROLES = ["ADMIN", "CEO", "FINANCE", "MARKETING", "OPERATIONS", "VISA", "GUIDE"] as const;
export type BaseRole = (typeof BASE_ROLES)[number];

export interface StaffRoleRow {
  id: string;
  agency_id: string;
  name: string;
  description: string | null;
  base_role: BaseRole;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface RolePermissionRow {
  id: string;
  role_id: string;
  module: PermissionModule;
  capabilities: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}
