import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG-6 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): when linking a new booking to its lead failed, the booking stayed behind and the
 * next attempt failed on the already-used reference. A booking already under the lead's reference is now linked instead of created again.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONVERSATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const GROUP = "44444444-4444-4444-8444-444444444444";
const OTHER_GROUP = "55555555-5555-4555-8555-555555555555";

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: ME }) }));
const createGroupBooking = vi.fn();
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role: "ADMIN", agencyId: AGENCY, staffId: ME, name: "Me" }),
  createGroupBooking: (...args: unknown[]) => createGroupBooking(...args),
}));
const markLeadBookedInStore = vi.fn();
vi.mock("@/lib/data/leads", () => ({ markLeadBookedInStore: (...args: unknown[]) => markLeadBookedInStore(...args), pricePerPerson: () => 100000, selectDepartureGroupInStore: vi.fn(), setFollowUpInStore: vi.fn() }));

const lead = { id: LEAD_ID, reference: "LD-0042", full_name: "Nimal", mobile: "0771234567", booking_id: null, selected_departure_group_id: GROUP, adults: 2, children: 0, room_preference: "DOUBLE", desired_package_id: null, journey_type: "UMRAH" };
const changeOneLead = vi.fn();
vi.mock("@/lib/data/leads-repository", () => ({
  loadLeadStore: async () => ({ leads: [lead], packages: [] }),
  changeOneLead: (...args: unknown[]) => changeOneLead(...args),
}));
const stampConversationSource = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
vi.mock("@/lib/inbox/conversions/source-link", () => ({ stampConversationSource: (...args: unknown[]) => stampConversationSource(...args) }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({}) }));

let existingBookings: Array<{ id: string; booking_reference: string; booking_status: string; departure_group_id: string } | null>;
let lookupError = false;
let lookups = 0;
vi.mock("@/utils/supabase/server", () => ({
  createClient: () => ({
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "ilike"]) query[method] = () => query;
      query.single = async () => ({ data: { lead_id: LEAD_ID }, error: null });
      query.maybeSingle = async () => {
        if (table !== "departure_group_bookings") return { data: null, error: null };
        const data = existingBookings[Math.min(lookups, existingBookings.length - 1)];
        lookups += 1;
        return lookupError ? { data: null, error: { message: "boom" } } : { data, error: null };
      };
      return query;
    },
  }),
}));

import { createBookingFromConversation } from "./actions";

const earlier = (extra: Partial<{ booking_status: string; departure_group_id: string }> = {}) => ({ id: "bk-earlier", booking_reference: "LD-0042", booking_status: "DEPOSIT_PENDING", departure_group_id: GROUP, ...extra });

beforeEach(() => {
  existingBookings = [null];
  lookupError = false;
  lookups = 0;
  createGroupBooking.mockReset();
  createGroupBooking.mockResolvedValue({ ok: true, result: { bookingId: "bk-new", bookingReference: "LD-0042" } });
  markLeadBookedInStore.mockReset();
  markLeadBookedInStore.mockReturnValue({ ok: true });
  stampConversationSource.mockClear();
  changeOneLead.mockReset();
  changeOneLead.mockImplementation(async (_db: unknown, _id: string, mutate: (store: unknown) => unknown) => mutate({ leads: [lead], activity: [] }));
});

describe("createBookingFromConversation — a booking that is already there", () => {
  it("creates and links a booking when there is none", async () => {
    expect(await createBookingFromConversation(CONVERSATION)).toEqual({ ok: true });
    expect(createGroupBooking).toHaveBeenCalledTimes(1);
    expect(markLeadBookedInStore.mock.calls[0][1]).toMatchObject({ bookingId: "bk-new", bookingReference: "LD-0042" });
  });

  it("links the booking an earlier attempt left behind, instead of failing on its reference", async () => {
    existingBookings = [earlier()];
    expect(await createBookingFromConversation(CONVERSATION)).toEqual({ ok: true });
    expect(createGroupBooking).not.toHaveBeenCalled();
    expect(markLeadBookedInStore.mock.calls[0][1]).toMatchObject({ bookingId: "bk-earlier", bookingReference: "LD-0042" });
  });

  it("does not adopt a cancelled booking, or one in another departure group, and creates nothing", async () => {
    existingBookings = [earlier({ booking_status: "CANCELLED" })];
    expect(await createBookingFromConversation(CONVERSATION)).toMatchObject({ ok: false, error: expect.stringContaining("cancelled") });
    lookups = 0;
    existingBookings = [earlier({ departure_group_id: OTHER_GROUP })];
    expect(await createBookingFromConversation(CONVERSATION)).toMatchObject({ ok: false, error: expect.stringContaining("different departure group") });
    expect(createGroupBooking).not.toHaveBeenCalled();
    expect(changeOneLead).not.toHaveBeenCalled();
  });

  it("creates nothing when it cannot tell whether a booking is already there", async () => {
    lookupError = true;
    expect(await createBookingFromConversation(CONVERSATION)).toMatchObject({ ok: false });
    expect(createGroupBooking).not.toHaveBeenCalled();
  });

  it("links the booking a second click just made, when its own create fails on the reference", async () => {
    existingBookings = [null, earlier()];
    createGroupBooking.mockResolvedValue({ ok: false, error: "Booking reference LD-0042 is already in use." });
    expect(await createBookingFromConversation(CONVERSATION)).toEqual({ ok: true });
    expect(markLeadBookedInStore.mock.calls[0][1]).toMatchObject({ bookingId: "bk-earlier" });
  });

  it("returns the create failure unchanged when no booking is there to link", async () => {
    createGroupBooking.mockResolvedValue({ ok: false, error: "That departure group is full." });
    expect(await createBookingFromConversation(CONVERSATION)).toEqual({ ok: false, error: "That departure group is full." });
  });

  it("says the booking exists and that a retry will link it, when linking fails again", async () => {
    changeOneLead.mockResolvedValue({ ok: false, error: "Someone else changed this lead just now. Refresh and try again." });
    const result = await createBookingFromConversation(CONVERSATION);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("will be linked, not created twice") });
    expect(createGroupBooking).toHaveBeenCalledTimes(1);
  });
});
