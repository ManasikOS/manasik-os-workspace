import type { SupabaseClient } from "@supabase/supabase-js";

import { capabilitiesFor, type StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { capabilitiesForPackages } from "@/lib/access/packages-access";
import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { capabilitiesForSuppliers } from "@/lib/access/suppliers-access";
import { capabilitiesForTeam } from "@/lib/access/team-access";
import type { GlobalSearchHit } from "@/lib/search/global-search-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** Hits per kind — enough to find the right record, small enough to scan at a glance. */
const HITS_PER_KIND = 5;

/** Lowest-effort way to put a row's readable pieces on one subtitle line. */
function joinSubtitle(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

/**
 * Every query runs on the caller's own Supabase client, so row-level security
 * still scopes it to the signed-in agency. The capability checks below decide
 * which kinds of record are *searched at all* — a role that cannot open a
 * module never sees its records appear here either. Roles that only see a
 * slice of a module (assigned groups only) are left out of that module's
 * results rather than risk showing a record outside their slice.
 */
export async function searchEverythingForStaff(
  db: Db,
  role: StaffRole,
  pattern: string,
): Promise<GlobalSearchHit[]> {
  const leadAccess = capabilitiesForLeads(role);
  const pilgrimAccess = capabilitiesForPilgrims(role);
  const departureAccess = capabilitiesFor(role);
  const packageAccess = capabilitiesForPackages(role);
  const supplierAccess = capabilitiesForSuppliers(role);
  const financeAccess = capabilitiesForFinance(role);
  const teamAccess = capabilitiesForTeam(role);

  const canSearchDepartures =
    departureAccess.viewModule && !departureAccess.restrictedToAssignedGroups;

  const searches: Array<Promise<GlobalSearchHit[]>> = [];

  if (leadAccess.viewModule) {
    searches.push(
      (async () => {
        let query = db
          .from("leads")
          .select("id, reference, full_name, mobile, city, booking_id")
          .or(
            `full_name.ilike.${pattern},reference.ilike.${pattern},mobile.ilike.${pattern},email.ilike.${pattern}`,
          )
          .limit(HITS_PER_KIND);
        // Finance / Operations / Visa only ever see leads that already converted.
        if (leadAccess.convertedOnly) query = query.not("booking_id", "is", null);
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          group: "lead" as const,
          title: row.full_name,
          subtitle: joinSubtitle([row.reference, row.mobile, row.city]),
          href: `/leads?open=${row.id}`,
        }));
      })(),
    );
  }

  if (pilgrimAccess.viewModule && !pilgrimAccess.assignedGroupOnly) {
    searches.push(
      (async () => {
        const { data, error } = await db
          .from("pilgrims")
          .select("id, reference, full_name, mobile_number, city")
          .or(
            `full_name.ilike.${pattern},reference.ilike.${pattern},mobile_number.ilike.${pattern},whatsapp_number.ilike.${pattern}`,
          )
          .limit(HITS_PER_KIND);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          group: "pilgrim" as const,
          title: row.full_name,
          subtitle: joinSubtitle([row.reference, row.mobile_number, row.city]),
          href: `/pilgrims/${row.id}`,
        }));
      })(),
    );
  }

  if (canSearchDepartures) {
    searches.push(
      (async () => {
        const { data, error } = await db
          .from("departure_group_bookings")
          .select(
            "id, booking_reference, booking_status, primary_contact_name, primary_contact_phone",
          )
          .or(
            `booking_reference.ilike.${pattern},primary_contact_name.ilike.${pattern},primary_contact_phone.ilike.${pattern}`,
          )
          .order("created_at", { ascending: false })
          .limit(HITS_PER_KIND);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          group: "booking" as const,
          title: row.booking_reference,
          subtitle: joinSubtitle([
            row.primary_contact_name,
            row.primary_contact_phone,
            String(row.booking_status).replace(/_/g, " ").toLowerCase(),
          ]),
          href: `/bookings?booking=${row.id}`,
        }));
      })(),
      (async () => {
        const { data, error } = await db
          .from("departure_groups")
          .select("id, group_name, group_code, group_status, departure_date")
          .or(`group_name.ilike.${pattern},group_code.ilike.${pattern}`)
          .order("departure_date", { ascending: false })
          .limit(HITS_PER_KIND);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          group: "departure_group" as const,
          title: row.group_name,
          subtitle: joinSubtitle([
            row.group_code,
            row.departure_date,
            String(row.group_status).replace(/_/g, " ").toLowerCase(),
          ]),
          href: `/departure-groups/${row.id}`,
        }));
      })(),
    );
  }

  if (packageAccess.viewModule) {
    searches.push(
      (async () => {
        const { data, error } = await db
          .from("packages")
          .select("id, title, internal_code, status, journey_type")
          .or(`title.ilike.${pattern},internal_code.ilike.${pattern}`)
          .limit(HITS_PER_KIND);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          group: "package" as const,
          title: row.title,
          subtitle: joinSubtitle([
            row.internal_code,
            row.journey_type,
            String(row.status).replace(/_/g, " ").toLowerCase(),
          ]),
          href: `/packages/${row.id}`,
        }));
      })(),
    );
  }

  if (supplierAccess.viewModule && !supplierAccess.assignedGroupOnly) {
    searches.push(
      (async () => {
        const { data, error } = await db
          .from("suppliers")
          .select("id, name, supplier_code, supplier_type, city, country")
          .or(`name.ilike.${pattern},supplier_code.ilike.${pattern}`)
          .limit(HITS_PER_KIND);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          group: "supplier" as const,
          title: row.name,
          subtitle: joinSubtitle([
            row.supplier_code,
            String(row.supplier_type).replace(/_/g, " ").toLowerCase(),
            row.city,
          ]),
          href: `/suppliers/${row.id}`,
        }));
      })(),
    );
  }

  if (financeAccess.viewModule && financeAccess.viewInvoices) {
    searches.push(
      (async () => {
        const { data, error } = await db
          .from("invoices")
          .select("id, invoice_number, party_name, status, currency, amount")
          .or(`invoice_number.ilike.${pattern},party_name.ilike.${pattern}`)
          .order("issued_at", { ascending: false })
          .limit(HITS_PER_KIND);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          group: "invoice" as const,
          title: row.invoice_number,
          subtitle: joinSubtitle([
            row.party_name,
            `${row.currency} ${row.amount}`,
            String(row.status).replace(/_/g, " ").toLowerCase(),
          ]),
          href: `/finance/invoices/${row.id}`,
        }));
      })(),
    );
  }

  if (teamAccess.viewModule && teamAccess.viewFullDirectory) {
    searches.push(
      (async () => {
        const { data, error } = await db
          .from("staff_profiles")
          .select("id, full_name, email, role")
          .or(`full_name.ilike.${pattern},email.ilike.${pattern}`)
          .limit(HITS_PER_KIND);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          group: "team_member" as const,
          title: row.full_name || row.email,
          subtitle: joinSubtitle([row.email, String(row.role).replace(/_/g, " ").toLowerCase()]),
          href: `/management/team/${row.id}`,
        }));
      })(),
    );
  }

  // One failing kind (a missing table, a transient error) must not blank the
  // rest — show what did load.
  const settled = await Promise.allSettled(searches);
  const hits: GlobalSearchHit[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") hits.push(...outcome.value);
    else console.error("global search: one record kind failed", outcome.reason);
  }
  return hits;
}
