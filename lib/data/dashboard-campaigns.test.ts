import { describe, expect, it } from "vitest";

import type { CampaignWithMetrics } from "@/lib/types/campaigns";

import { buildCampaignPulse, CAMPAIGN_PULSE_ROW_LIMIT } from "./dashboard-campaigns";

const NOW = "2026-10-13T09:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.parse(NOW) + d * DAY).toISOString();

let seq = 0;

function campaign(overrides: Partial<CampaignWithMetrics> = {}, metrics: Partial<CampaignWithMetrics["metrics"]> = {}): CampaignWithMetrics {
  seq += 1;
  return {
    id: `c${seq}`,
    name: `Campaign ${seq}`,
    status: "ACTIVE",
    channel: "WHATSAPP",
    end_date: inDays(10),
    target_leads: 40,
    target_bookings: 10,
    metrics: {
      leadCount: 12,
      qualifiedLeadCount: 5,
      bookingCount: 3,
      totalSpend: 99_000,
      revenue: 777_000,
      estimatedGrossMargin: 55_000,
      ...metrics,
    },
    capacity: null,
    ...overrides,
  } as unknown as CampaignWithMetrics;
}

describe("buildCampaignPulse", () => {
  it("counts campaigns by status", () => {
    const data = buildCampaignPulse(
      [
        campaign({ status: "ACTIVE" }),
        campaign({ status: "ACTIVE" }),
        campaign({ status: "SCHEDULED" }),
        campaign({ status: "PAUSED" }),
        campaign({ status: "DRAFT" }),
        campaign({ status: "COMPLETED" }),
      ],
      NOW,
    );
    expect(data.counts).toEqual({ active: 2, scheduled: 1, paused: 1 });
    expect(data.total).toBe(6);
  });

  it("lists only active campaigns, the ones ending soonest first, undated last", () => {
    const data = buildCampaignPulse(
      [
        campaign({ name: "Undated", end_date: null }),
        campaign({ name: "Later", end_date: inDays(20) }),
        campaign({ name: "Soon", end_date: inDays(3) }),
        campaign({ name: "Paused one", status: "PAUSED", end_date: inDays(1) }),
      ],
      NOW,
    );
    expect(data.campaigns.map((c) => c.name)).toEqual(["Soon", "Later", "Undated"]);
  });

  it("shows progress against the campaign's own targets and its linked departure's seats left", () => {
    const data = buildCampaignPulse(
      [
        campaign(
          { target_leads: 40, target_bookings: 10, capacity: { groupName: "Umrah Dec", availableSeats: 8 } as never },
          { leadCount: 12, bookingCount: 3 },
        ),
      ],
      NOW,
    );
    expect(data.campaigns[0]).toMatchObject({
      leads: 12,
      targetLeads: 40,
      bookings: 3,
      targetBookings: 10,
      seatsLeft: 8,
      linkedGroupName: "Umrah Dec",
    });
  });

  it("leaves seats and targets empty when the campaign has none, instead of inventing a zero", () => {
    const data = buildCampaignPulse([campaign({ target_leads: null, target_bookings: null, capacity: null })], NOW);
    expect(data.campaigns[0].targetLeads).toBeNull();
    expect(data.campaigns[0].targetBookings).toBeNull();
    expect(data.campaigns[0].seatsLeft).toBeNull();
  });

  it("flags an active campaign whose end date has passed - something to close or extend", () => {
    const data = buildCampaignPulse(
      [campaign({ name: "Overran", end_date: inDays(-3) }), campaign({ name: "Fine", end_date: inDays(5) })],
      NOW,
    );
    const overran = data.campaigns.find((c) => c.name === "Overran");
    const fine = data.campaigns.find((c) => c.name === "Fine");
    expect(overran?.pastEnd).toBe(true);
    expect(overran?.daysToEnd).toBe(-3);
    expect(fine?.pastEnd).toBe(false);
    expect(fine?.daysToEnd).toBe(5);
    expect(data.counts.active).toBe(2);
  });

  it("limits the list but still reports how many are active", () => {
    const many = Array.from({ length: CAMPAIGN_PULSE_ROW_LIMIT + 3 }, (_, i) => campaign({ end_date: inDays(i + 1) }));
    const data = buildCampaignPulse(many, NOW);
    expect(data.campaigns).toHaveLength(CAMPAIGN_PULSE_ROW_LIMIT);
    expect(data.counts.active).toBe(CAMPAIGN_PULSE_ROW_LIMIT + 3);
  });

  it("carries no spend, revenue or margin", () => {
    const serialised = JSON.stringify(buildCampaignPulse([campaign()], NOW));
    expect(serialised).not.toContain("99000");
    expect(serialised).not.toContain("777000");
    expect(serialised).not.toContain("55000");
  });

  it("returns zeros for an agency with no campaigns", () => {
    expect(buildCampaignPulse([], NOW)).toEqual({
      counts: { active: 0, scheduled: 0, paused: 0 },
      campaigns: [],
      total: 0,
    });
  });
});
