import { capabilitiesFor, type StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { capabilitiesForOperations } from "@/lib/access/operations-access";
import { capabilitiesForPackages } from "@/lib/access/packages-access";
import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { capabilitiesForReports } from "@/lib/access/reports-access";
import { capabilitiesForTeam } from "@/lib/access/team-access";
import type { GlobalSearchPage } from "@/lib/search/global-search-types";

/**
 * The pages a person can jump to by name from the header search. Uses the
 * same capability checks as the sidebar, so the search never offers a page
 * the sidebar would hide.
 */
export function listSearchablePagesForRole(role: StaffRole): GlobalSearchPage[] {
  const leads = capabilitiesForLeads(role);
  const finance = capabilitiesForFinance(role);

  const candidates: Array<GlobalSearchPage & { visible: boolean }> = [
    { title: "Dashboard", href: "/dashboard", keywords: "home overview", visible: true },
    { title: "Leads", href: "/leads", keywords: "enquiries prospects pipeline", visible: leads.viewModule },
    { title: "Campaigns", href: "/campaigns", keywords: "marketing ads", visible: leads.viewModule },
    { title: "Audiences", href: "/audiences", keywords: "segments marketing", visible: leads.viewModule },
    { title: "Referrals", href: "/referrals", keywords: "refer friends", visible: leads.viewModule },
    { title: "Quotes", href: "/quotes", keywords: "proposals pricing", visible: leads.viewModule && leads.viewQuotes },
    { title: "Bookings", href: "/bookings", keywords: "reservations", visible: capabilitiesFor(role).viewModule },
    { title: "Pilgrims", href: "/pilgrims", keywords: "travellers customers passengers", visible: capabilitiesForPilgrims(role).viewModule },
    { title: "Packages", href: "/packages", keywords: "umrah hajj catalogue", visible: capabilitiesForPackages(role).viewModule },
    { title: "Departure groups", href: "/departure-groups", keywords: "trips batches flights", visible: capabilitiesFor(role).viewModule },
    { title: "Operations", href: "/operations", keywords: "tasks readiness", visible: capabilitiesForOperations(role).viewModule },
    { title: "Finance overview", href: "/finance", keywords: "money payments", visible: finance.viewModule },
    { title: "Invoices", href: "/finance/invoices", keywords: "billing finance", visible: finance.viewModule && finance.viewInvoices },
    { title: "Reports", href: "/reports", keywords: "export data", visible: capabilitiesForReports(role).viewModule },
    { title: "Analytics", href: "/analytics", keywords: "charts growth", visible: capabilitiesForReports(role).viewOverview },
    { title: "Team", href: "/management/team", keywords: "staff members users roles", visible: capabilitiesForTeam(role).viewModule },
  ];

  return candidates
    .filter((page) => page.visible)
    .map(({ title, href, keywords }) => ({ title, href, keywords }));
}
