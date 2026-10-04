import { describe, expect, it } from "vitest";

import { buildBrochureViewModel } from "@/lib/content/brochure-view-model";
import type { DepartureGroupPackageSnapshotRow, DepartureGroupPricingRow, DepartureGroupRow } from "@/lib/types/departure-groups";

function makeGroup(overrides: Partial<DepartureGroupRow> = {}): DepartureGroupRow {
  return {
    id: "group-1",
    agency_id: "agency-1",
    branch_id: null,
    branch: "Main",
    package_template_id: "template-1",
    group_name: "Ramadan Umrah 15D",
    group_code: "RU15D-01",
    journey_type: "UMRAH",
    group_status: "OPEN",
    sales_status: "SELLING",
    departure_date: "2026-03-10",
    return_date: "2026-03-25",
    duration_days: 15,
    duration_nights: 14,
    capacity: 40,
    minimum_group_size: 10,
    booked_seats: 5,
    held_seats: 0,
    available_seats: 35,
    waitlist_enabled: false,
    seat_hold_expiry_hours: 48,
    primary_guide_id: null,
    primary_guide_name: null,
    primary_guide_supplier_id: null,
    backup_guide_name: null,
    operations_owner_id: null,
    operations_owner_name: null,
    visa_owner_id: null,
    visa_owner_name: null,
    finance_owner_id: null,
    finance_owner_name: null,
    local_coordinator_name: null,
    local_coordinator_phone: null,
    emergency_phone: null,
    guide_whatsapp_link: null,
    pilgrim_broadcast_link: null,
    umrah_company_name: null,
    nusuk_program_ref: null,
    nusuk_group_ref: null,
    visa_batch_ref: null,
    visa_invoice_ref: null,
    nusuk_status: "NOT_STARTED",
    readiness_score: 0,
    readiness_status: "ON_TRACK",
    ready_at: null,
    departed_at: null,
    completed_at: null,
    closed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    updated_by: null,
    ...overrides,
  } as DepartureGroupRow;
}

function makeSnapshot(overrides: Partial<DepartureGroupPackageSnapshotRow> = {}): DepartureGroupPackageSnapshotRow {
  return {
    departure_group_id: "group-1",
    package_template_id: "template-1",
    source_template_key: "template-1",
    package_name_snapshot: "Ramadan Umrah 15D",
    package_code_snapshot: "RU15D",
    overview_snapshot: "A 15-day Ramadan Umrah package.",
    pricing_snapshot: {
      currency: "SAR",
      quad_price: 4500,
      triple_price: 5000,
      double_price: 5500,
      single_price: 7000,
      child_price: 3500,
      infant_price: 0,
      advance_deposit: 500,
    },
    payment_schedule_snapshot: [],
    itinerary_snapshot: [
      { id: "d2", day_number: 2, title: "Madinah", location: "Madinah", description: "Arrival", category: "TRAVEL" },
      { id: "d1", day_number: 1, title: "Departure", location: "Colombo", description: "Flight out", category: "TRAVEL" },
    ],
    inclusions_snapshot: ["Flights", "Hotels"],
    exclusions_snapshot: ["Personal expenses"],
    accommodation_standards_snapshot: [
      { city: "MAKKAH", standard: "5-star", customer_wording: "5-star hotel near Haram", nights: 7, meal_plan: "Full board", target_distance: "500m", occupancies: ["QUAD", "TRIPLE"] },
    ],
    transport_requirements_snapshot: [],
    traveller_requirements_snapshot: [],
    readiness_requirements_snapshot: [],
    copied_at: "2026-01-01T00:00:00Z",
    package_version_id: null,
    policy_snapshot: {
      cancellationPolicy: "No refund within 30 days.",
      paymentTerms: "50% deposit, balance 30 days before departure.",
      latePaymentPolicy: "Seat released if unpaid.",
      priceChangeDisclaimer: "Prices may change due to airline fare fluctuation.",
    },
    included_services_snapshot: ["Visa processing", "Ziyarat tours"],
    duration_days_snapshot: 15,
    duration_nights_snapshot: 14,
    seat_reservation_rule_snapshot: "FIRST_COME",
    communication_templates_snapshot: [],
    ...overrides,
  } as DepartureGroupPackageSnapshotRow;
}

function makePricing(overrides: Partial<DepartureGroupPricingRow> = {}): DepartureGroupPricingRow {
  return {
    departure_group_id: "group-1",
    currency: "SAR",
    quad_price: 4700,
    triple_price: 5200,
    double_price: 5700,
    single_price: 7200,
    child_price: 3600,
    infant_price: null,
    early_bird_price: null,
    early_bird_valid_until: null,
    advance_deposit: 500,
    payment_milestones: [],
    price_source: "TEMPLATE",
    priced_by: null,
    priced_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as DepartureGroupPricingRow;
}

describe("buildBrochureViewModel", () => {
  it("prefers the live pricing row over the frozen snapshot when both have a value", () => {
    const model = buildBrochureViewModel({ group: makeGroup(), snapshot: makeSnapshot(), pricing: makePricing() });
    const quad = model.occupancyPrices.find((p) => p.label === "Quad Sharing");
    expect(quad?.amount).toBe(4700); // live, not the snapshot's 4500
  });

  it("falls back to the snapshot price when the live row has no value for that occupancy", () => {
    const model = buildBrochureViewModel({ group: makeGroup(), snapshot: makeSnapshot(), pricing: makePricing({ infant_price: null }) });
    const infant = model.occupancyPrices.find((p) => p.label === "Infant");
    expect(infant?.amount).toBe(0); // snapshot's infant_price
  });

  it("omits an occupancy entirely when neither the live row nor the snapshot has a value", () => {
    const model = buildBrochureViewModel({
      group: makeGroup(),
      snapshot: makeSnapshot({ pricing_snapshot: { ...makeSnapshot().pricing_snapshot, infant_price: null } }),
      pricing: makePricing({ infant_price: null }),
    });
    expect(model.occupancyPrices.find((p) => p.label === "Infant")).toBeUndefined();
  });

  it("sorts the itinerary by day number regardless of snapshot array order", () => {
    const model = buildBrochureViewModel({ group: makeGroup(), snapshot: makeSnapshot(), pricing: makePricing() });
    expect(model.itinerary.map((item) => item.dayNumber)).toEqual([1, 2]);
  });

  it("formats a multi-day, multi-night duration label", () => {
    const model = buildBrochureViewModel({ group: makeGroup({ duration_days: 15, duration_nights: 14 }), snapshot: makeSnapshot(), pricing: makePricing() });
    expect(model.durationLabel).toBe("15 Days / 14 Nights");
  });

  it("formats a single-day, single-night duration label without a plural 's'", () => {
    const model = buildBrochureViewModel({ group: makeGroup({ duration_days: 1, duration_nights: 1 }), snapshot: makeSnapshot(), pricing: makePricing() });
    expect(model.durationLabel).toBe("1 Day / 1 Night");
  });

  it("uses the live pricing row's currency over the snapshot's", () => {
    const model = buildBrochureViewModel({ group: makeGroup(), snapshot: makeSnapshot(), pricing: makePricing({ currency: "LKR" }) });
    expect(model.currency).toBe("LKR");
  });
});
