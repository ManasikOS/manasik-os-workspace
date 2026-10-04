import { describe, expect, it } from "vitest";
import { projection, reconcile } from "../../scripts/audits/departure-reconcile.mjs";

function cleanRows(): Record<string, Record<string, unknown>[]> {
  const rows = Object.fromEntries(Object.keys(projection).map(t => [t, []])) as Record<string, Record<string, unknown>[]>;
  rows.departure_groups.push({ id: "g", agency_id: "a", capacity: 10, booked_seats: 1, held_seats: 0 });
  rows.departure_group_bookings.push({ id: "b", agency_id: "a", departure_group_id: "g", booking_status: "CONFIRMED",
    traveller_count: 1, total_booking_value: 100, amount_paid: 30, outstanding_balance: 70 });
  rows.booking_payment_milestones.push({ id: "m", agency_id: "a", departure_group_id: "g", booking_id: "b", amount: 100, paid_amount: 30, waived: false });
  rows.payments.push({ id: "p", agency_id: "a", departure_group_id: "g", booking_id: "b", amount: 30, currency: "LKR", status: "COMPLETED" });
  return rows;
}

describe("read-only reconciliation diagnostics", () => {
  it("reports no mismatches for consistent data and does not mutate it", () => {
    const rows = cleanRows(); const before = structuredClone(rows);
    expect(Object.values(reconcile(rows)).every(n => n === 0)).toBe(true);
    expect(rows).toEqual(before);
  });
  it("rejects an incomplete projection instead of reporting zero", () => {
    const rows = cleanRows(); delete rows.payments;
    expect(() => reconcile(rows)).toThrow("Missing projection: payments");
  });
  it("detects a missing plan and unledgered deposit independently", () => {
    const rows = cleanRows(); rows.booking_payment_milestones = []; rows.payments = [];
    const result = reconcile(rows);
    expect(result.missing_active_milestones).toBe(1);
    expect(result.booking_ledger_mismatch).toBe(1);
  });
  it("detects schedule and group ownership drift", () => {
    const rows = cleanRows(); rows.booking_payment_milestones[0].amount = 200;
    rows.booking_payment_milestones[0].departure_group_id = "old-group";
    expect(reconcile(rows).schedule_value_mismatch).toBe(1);
    expect(reconcile(rows).milestone_group_or_tenant_candidate).toBe(1);
  });
  it("does not double subtract reversed originals and counts actual refunds", () => {
    const rows = cleanRows(); const p = rows.payments[0];
    rows.payments.push({ ...p, id: "old", amount: 100, status: "REVERSED" },
      { ...p, id: "contra", amount: -100, status: "REVERSED" },
      { ...p, id: "pending", amount: 400, status: "PENDING_VERIFICATION" },
      { ...p, id: "refund", amount: -10, status: "REFUNDED" });
    rows.departure_group_bookings[0].amount_paid = 20;
    expect(reconcile(rows).booking_ledger_mismatch).toBe(0);
  });
  it("flags mixed currencies without treating their sum as money", () => {
    const rows = cleanRows(); rows.payments.push({ ...rows.payments[0], id: "usd", currency: "USD", amount: 10 });
    expect(reconcile(rows).multiple_payment_currencies).toBe(1);
    expect(reconcile(rows).booking_ledger_mismatch).toBe(0);
  });
  it("detects cancellation debt and refund flags without requests", () => {
    const rows = cleanRows(); rows.departure_group_bookings[0].booking_status = "CANCELLED";
    rows.departure_group_pilgrims.push({ id: "traveller", booking_id: "b", payment_status: "REFUND_PENDING" });
    expect(reconcile(rows).cancelled_booking_has_debt).toBe(1);
    expect(reconcile(rows).refund_flag_request_mismatch).toBe(1);
  });
  it("detects stale seat, room and ticket counters", () => {
    const rows = cleanRows(); rows.departure_groups[0].booked_seats = 2;
    rows.departure_group_rooms.push({ id: "room", assigned_pilgrim_count: 1, occupancy_capacity: 4 });
    rows.departure_group_flights.push({ id: "flight", departure_group_id: "g", direction: "OUTBOUND", seats_ticketed: 1 });
    const result = reconcile(rows);
    expect([result.seat_counter_mismatch, result.room_counter_mismatch, result.outbound_ticket_counter_candidate]).toEqual([1, 1, 1]);
  });
  it("detects an invoice header mismatch and excessive allocations", () => {
    const rows = cleanRows(); rows.invoices.push({ id: "i", amount: 100 });
    rows.invoice_line_items.push({ id: "l", invoice_id: "i", line_total: 99.99 });
    rows.payment_allocations.push({ id: "a", payment_id: "p", milestone_id: "m", amount: 31 });
    expect(reconcile(rows).invoice_header_line_mismatch).toBe(1);
    expect(reconcile(rows).allocation_exceeds_payment).toBe(1);
  });
});
