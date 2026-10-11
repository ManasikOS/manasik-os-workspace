/**
 * What deleting a package would touch, in words a person can act on (TASK-043). The counts come from `package_delete_impact()`
 * (supabase/migrations/20270120090600_packages_controlled_delete.sql); the database applies the same blocking rules again when the delete is attempted.
 */

export interface PackageDeleteImpact {
  status: string;
  departureGroups: number;
  groupSnapshots: number;
  leadQuotes: number;
  agentSubmissions: number;
  leadsPreferringIt: number;
  campaigns: number;
  agentAllocations: number;
  websiteContent: number;
  pendingChanges: number;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Why this package cannot be deleted right now, or null when it can. */
export function deleteBlocker(impact: PackageDeleteImpact): string | null {
  if (impact.status !== "Draft" && impact.status !== "Archived") {
    return `This package is ${impact.status}. Close its sales and archive it first; only a draft or an archived package can be deleted.`;
  }
  if (impact.departureGroups > 0 || impact.groupSnapshots > 0) {
    const count = Math.max(impact.departureGroups, impact.groupSnapshots);
    return `${plural(count, "departure group uses", "departure groups use")} this package. Archive it instead, or move those groups to another package first.`;
  }
  if (impact.leadQuotes > 0 || impact.agentSubmissions > 0) {
    const parts = [
      impact.leadQuotes > 0 ? plural(impact.leadQuotes, "lead quote", "lead quotes") : null,
      impact.agentSubmissions > 0 ? plural(impact.agentSubmissions, "agent booking submission", "agent booking submissions") : null,
    ].filter(Boolean);
    return `${parts.join(" and ")} refer to this package and would lose their link. Archive it instead.`;
  }
  return null;
}

/** What the delete will quietly remove or unlink, shown so it is not a surprise. */
export function deleteSideEffects(impact: PackageDeleteImpact): string[] {
  const effects: string[] = [];
  if (impact.leadsPreferringIt > 0) {
    effects.push(`${plural(impact.leadsPreferringIt, "lead names", "leads name")} this as the package they want; that link is cleared.`);
  }
  if (impact.campaigns > 0) effects.push(`${plural(impact.campaigns, "campaign is", "campaigns are")} linked to it; the link is cleared.`);
  if (impact.agentAllocations > 0) effects.push(`${plural(impact.agentAllocations, "agent allocation", "agent allocations")} will be removed.`);
  if (impact.websiteContent > 0) effects.push(`${plural(impact.websiteContent, "website content item", "website content items")} will be removed.`);
  if (impact.pendingChanges > 0) effects.push(`${plural(impact.pendingChanges, "change", "changes")} waiting for approval will be discarded.`);
  return effects;
}
