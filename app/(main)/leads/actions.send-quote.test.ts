import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * LD-05: a quote the customer receives is priced by the server. The browser sends the lead, the channel and the price it displayed; it cannot set
 * the price, the total, the deposit, the party size or the group label, and it cannot send a quote for a group that is closed or full.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role: "MARKETING", name: "Amina", staffId: "staff-1" }),
  createGroupBooking: vi.fn(),
}));
vi.mock("@/lib/data/lead-references", () => ({ allocateReferences: async () => ["QT-2030-0001"] }));

const LEAD_ID = "11111111-1111-4111-8111-111111111111";

interface GroupRow {
  group_name: string;
  group_code: string;
  departure_date: string;
  return_date: string;
  sales_status: string;
  group_status: string;
  archived: boolean;
  available_seats: number;
}

let group: GroupRow | null = null;
const written: Array<Record<string, unknown>> = [];

vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: () => {
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = async () => ({ data: group, error: null });
      return query;
    },
  }),
}));

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    reference: "LD-2030-0001",
    booking_id: null,
    desired_package_id: "pkg-1",
    desired_package_name: "12 Days Economy",
    interested_in: "Umrah",
    journey_type: "UMRAH",
    room_preference: "QUAD",
    adults: 2,
    children: 1,
    stage: "QUALIFIED",
    selected_departure_group_id: null,
    ...overrides,
  };
}

let lead = leadRow();

vi.mock("@/lib/data/leads-repository", async () => {
  const real = await vi.importActual<typeof import("@/lib/data/leads-repository")>("@/lib/data/leads-repository");
  return {
    ...real,
    loadLeadStore: async () => ({
      ...real.emptyLeadStore(),
      leads: [lead],
      packages: [
        { id: "pkg-1", name: "12 Days Economy", journey_type: "UMRAH", currency: "LKR", quad_price: 450_000, triple_price: null, double_price: null, single_price: null, price_per_person_lkr: 450_000 },
      ],
    }),
    changeOneLead: async (_db: unknown, _id: string, mutate: (store: unknown) => { ok: boolean }) => {
      const store = { ...real.emptyLeadStore(), leads: [lead] };
      const outcome = mutate(store);
      written.push(...(store.quotes as unknown as Array<Record<string, unknown>>));
      return outcome;
    },
  };
});

import { sendQuoteAction } from "./actions";

beforeEach(() => {
  group = null;
  lead = leadRow();
  written.length = 0;
});

describe("sendQuoteAction", () => {
  it("prices the quote from the server's figures, not the browser's", async () => {
    const result = await sendQuoteAction({ leadId: LEAD_ID, sentVia: "WHATSAPP", expectedRoomPricePerPerson: 450_000 });

    expect(result).toMatchObject({ ok: true, reference: "QT-2030-0001", totalLkr: 1_350_000, depositLkr: 270_000 });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ total_lkr: 1_350_000, deposit_lkr: 270_000, adults: 2, children: 1, price_per_person: 450_000, status: "SENT" });
  });

  it("refuses when the price shown is not the price on offer", async () => {
    const result = await sendQuoteAction({ leadId: LEAD_ID, sentVia: "WHATSAPP", expectedRoomPricePerPerson: 1 });
    expect(result.ok).toBe(false);
    expect(written).toHaveLength(0);
  });

  it("ignores any extra fields a caller adds", async () => {
    const result = await sendQuoteAction({
      leadId: LEAD_ID,
      sentVia: "EMAIL",
      expectedRoomPricePerPerson: 450_000,
      roomPricePerPerson: 1,
      adults: 100,
      total: 5,
    } as never);

    expect(result.ok).toBe(true);
    expect(written[0]).toMatchObject({ total_lkr: 1_350_000, adults: 2 });
  });

  it("refuses an invalid request", async () => {
    expect((await sendQuoteAction({ leadId: "nope", sentVia: null, expectedRoomPricePerPerson: 450_000 })).ok).toBe(false);
    expect((await sendQuoteAction({ leadId: LEAD_ID, sentVia: "CARRIER_PIGEON" as never, expectedRoomPricePerPerson: 450_000 })).ok).toBe(false);
    expect((await sendQuoteAction({ leadId: LEAD_ID, sentVia: null, expectedRoomPricePerPerson: -5 })).ok).toBe(false);
  });

  it("refuses a lead that has already converted", async () => {
    lead = leadRow({ booking_id: "booking-1" });
    expect((await sendQuoteAction({ leadId: LEAD_ID, sentVia: null, expectedRoomPricePerPerson: 450_000 })).ok).toBe(false);
  });

  it("takes the group's label and dates from the group, and refuses one that is closed or full", async () => {
    lead = leadRow({ selected_departure_group_id: "22222222-2222-4222-8222-222222222222" });

    group = {
      group_name: "Ramadan Economy",
      group_code: "RAM-27",
      departure_date: "2030-03-01",
      return_date: "2030-03-13",
      sales_status: "SELLING",
      group_status: "OPEN",
      archived: false,
      available_seats: 10,
    };
    const open = await sendQuoteAction({ leadId: LEAD_ID, sentVia: null, expectedRoomPricePerPerson: 450_000 });
    expect(open.ok).toBe(true);
    expect((written[0].pricing_snapshot as { groupLabel: string }).groupLabel).toBe("Ramadan Economy (RAM-27)");

    written.length = 0;
    group = { ...group, sales_status: "CLOSED" };
    expect((await sendQuoteAction({ leadId: LEAD_ID, sentVia: null, expectedRoomPricePerPerson: 450_000 })).ok).toBe(false);

    group = { ...group, sales_status: "SELLING", available_seats: 2 };
    const full = await sendQuoteAction({ leadId: LEAD_ID, sentVia: null, expectedRoomPricePerPerson: 450_000 });
    expect(full).toMatchObject({ ok: false });
    expect(written).toHaveLength(0);
  });
});
