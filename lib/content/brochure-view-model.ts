/**
 * Pure mapping from a departure group's rows to what the brochure PDF
 * renders. No I/O, no React-PDF — kept separate from `brochure-pdf.tsx` so
 * the branching (which price wins, which rows are worth showing) is
 * testable without rendering a PDF.
 */

import type {
  AccommodationStandardSnapshot,
  DepartureGroupPackageSnapshotRow,
  DepartureGroupPricingRow,
  DepartureGroupRow,
  ItinerarySnapshotItem,
} from "@/lib/types/departure-groups";

export interface BrochureOccupancyPrice {
  label: string;
  amount: number;
}

export interface BrochureViewModel {
  groupName: string;
  groupCode: string;
  overview: string;
  departureDate: string;
  returnDate: string;
  durationLabel: string;
  currency: string;
  occupancyPrices: BrochureOccupancyPrice[];
  itinerary: { dayNumber: number; title: string; location: string; description: string }[];
  accommodations: AccommodationStandardSnapshot[];
  inclusions: string[];
  exclusions: string[];
  includedServices: string[];
  policy: { cancellationPolicy: string; paymentTerms: string; latePaymentPolicy: string; priceChangeDisclaimer: string };
}

const OCCUPANCY_LABELS: { key: keyof Pick<DepartureGroupPricingRow, "quad_price" | "triple_price" | "double_price" | "single_price" | "child_price" | "infant_price">; label: string }[] = [
  { key: "quad_price", label: "Quad Sharing" },
  { key: "triple_price", label: "Triple Sharing" },
  { key: "double_price", label: "Double Sharing" },
  { key: "single_price", label: "Single Occupancy" },
  { key: "child_price", label: "Child" },
  { key: "infant_price", label: "Infant" },
];

const SNAPSHOT_PRICE_BY_KEY: Record<string, keyof DepartureGroupPackageSnapshotRow["pricing_snapshot"]> = {
  quad_price: "quad_price",
  triple_price: "triple_price",
  double_price: "double_price",
  single_price: "single_price",
  child_price: "child_price",
  infant_price: "infant_price",
};

/**
 * The live `departure_group_pricing` row is what every booking actually
 * prices against, so it wins whenever it has a value. The frozen snapshot
 * is only a fallback for an occupancy the live row has never had a value
 * for (it is seeded from the snapshot at creation, so this should be rare,
 * not the normal path) — a brochure with no price for an occupancy the
 * group actually sells would be a worse failure than showing a slightly
 * stale one.
 */
function resolveOccupancyPrices(
  pricing: DepartureGroupPricingRow,
  snapshot: DepartureGroupPackageSnapshotRow,
): BrochureOccupancyPrice[] {
  const prices: BrochureOccupancyPrice[] = [];
  for (const { key, label } of OCCUPANCY_LABELS) {
    const live = pricing[key];
    const snapshotKey = SNAPSHOT_PRICE_BY_KEY[key];
    const fallback = snapshotKey ? (snapshot.pricing_snapshot[snapshotKey] as number | null) : null;
    const amount = live ?? fallback;
    if (amount === null || amount === undefined) continue;
    prices.push({ label, amount });
  }
  return prices;
}

function sortedItinerary(items: ItinerarySnapshotItem[]): BrochureViewModel["itinerary"] {
  return [...items]
    .sort((a, b) => a.day_number - b.day_number)
    .map((item) => ({ dayNumber: item.day_number, title: item.title, location: item.location, description: item.description }));
}

function durationLabel(days: number, nights: number): string {
  const dayPart = days === 1 ? "1 Day" : `${days} Days`;
  const nightPart = nights === 1 ? "1 Night" : `${nights} Nights`;
  return `${dayPart} / ${nightPart}`;
}

export function buildBrochureViewModel(input: {
  group: DepartureGroupRow;
  snapshot: DepartureGroupPackageSnapshotRow;
  pricing: DepartureGroupPricingRow;
}): BrochureViewModel {
  const { group, snapshot, pricing } = input;
  return {
    groupName: group.group_name,
    groupCode: group.group_code,
    overview: snapshot.overview_snapshot,
    departureDate: group.departure_date,
    returnDate: group.return_date,
    durationLabel: durationLabel(group.duration_days, group.duration_nights),
    currency: pricing.currency || snapshot.pricing_snapshot.currency,
    occupancyPrices: resolveOccupancyPrices(pricing, snapshot),
    itinerary: sortedItinerary(snapshot.itinerary_snapshot),
    accommodations: snapshot.accommodation_standards_snapshot,
    inclusions: snapshot.inclusions_snapshot,
    exclusions: snapshot.exclusions_snapshot,
    includedServices: snapshot.included_services_snapshot,
    policy: snapshot.policy_snapshot,
  };
}
