/**
 * What sending an approved WhatsApp template is expected to cost, in words. The rate is the latest one Meta reported for this
 * recipient country and category; when none has been seen we say so instead of showing a made-up number.
 */
export function templateChargeLabel(template: { projected_charge?: number | null; charge_currency?: string | null }): string {
  if (template.projected_charge === null || template.projected_charge === undefined || !template.charge_currency) {
    return "Projected charge unavailable — no matching Meta rate has been observed yet";
  }
  return `Projected charge: ${template.charge_currency} ${template.projected_charge.toFixed(3)}`;
}

/** "MARKETING" → "Marketing". Meta's category decides the price, so staff should see it by name. */
export function templateCategoryLabel(category: string): string {
  const lower = category.trim().toLowerCase();
  return lower ? lower[0].toUpperCase() + lower.slice(1) : "Unknown";
}
