// Pure, report-only reconciliation over minimal API projections. No PII is needed.
// A mismatch is a review candidate, not permission to synthesize missing money.
export const projection = {
  departure_groups: 'id,agency_id,capacity,booked_seats,held_seats',
  departure_group_bookings: 'id,agency_id,departure_group_id,booking_status,traveller_count,total_booking_value,amount_paid,outstanding_balance,cancellation_refund_amount',
  booking_payment_milestones: 'id,agency_id,booking_id,departure_group_id,amount,paid_amount,waived',
  payments: 'id,agency_id,booking_id,departure_group_id,amount,currency,status',
  refund_requests: 'id,agency_id,booking_id,departure_group_id,amount,status',
  invoices: 'id,agency_id,booking_id,departure_group_id,amount',
  invoice_line_items: 'id,invoice_id,line_total',
  departure_group_pilgrims: 'id,booking_id,departure_group_id,payment_status,flight_status,excluded_from_group_flight',
  departure_group_rooms: 'id,accommodation_id,assigned_pilgrim_count,occupancy_capacity',
  departure_group_room_assignments: 'id,room_id',
  departure_group_flights: 'id,departure_group_id,direction,seats_ticketed',
  payment_allocations: 'id,payment_id,milestone_id,amount',
};
const cents = n => Math.round(Number(n) * 100);
const sum = (rows, field) => rows.reduce((n, r) => n + cents(r[field]), 0);

export function reconcile(rows) {
  // Incomplete reads must fail closed, never generate reassuring zero counts.
  for (const table of Object.keys(projection)) {
    if (!Array.isArray(rows[table])) throw new Error(`Missing projection: ${table}`);
  }
  /** @type {Record<string, number>} */
  const findings = {};
  const count = (name, condition) => { findings[name] = (findings[name] ?? 0) + Number(condition); };
  const bookings = rows.departure_group_bookings;
  const payments = rows.payments;
  const milestones = rows.booking_payment_milestones;
  for (const b of bookings) {
    const schedule = milestones.filter(m => m.booking_id === b.id && !m.waived);
    const live = !['CANCELLED', 'WAITLIST'].includes(b.booking_status);
    count('missing_active_milestones', live && cents(b.total_booking_value) > 0 && schedule.length === 0);
    count('schedule_value_mismatch', live && schedule.length > 0 && sum(schedule, 'amount') !== cents(b.total_booking_value));
    // Exclude both REVERSED originals and their contra rows; include REFUNDED payouts.
    const posted = payments.filter(p => p.booking_id === b.id && ['COMPLETED', 'REFUNDED'].includes(p.status));
    const currencies = new Set(posted.map(p => p.currency));
    count('multiple_payment_currencies', currencies.size > 1);
    count('booking_ledger_mismatch', currencies.size <= 1 && sum(posted, 'amount') !== cents(b.amount_paid));
    count('cancelled_booking_has_debt', b.booking_status === 'CANCELLED' && cents(b.outstanding_balance) > 0);
    const refunds = rows.refund_requests.filter(r => r.booking_id === b.id && ['PENDING_APPROVAL', 'APPROVED'].includes(r.status));
    const flag = rows.departure_group_pilgrims.some(p => p.booking_id === b.id && p.payment_status === 'REFUND_PENDING');
    count('refund_flag_request_mismatch', (refunds.length > 0) !== flag);
    count('refund_exceeds_held_money', sum(refunds, 'amount') > cents(b.amount_paid));
    count('cancellation_refund_projection_mismatch', b.booking_status === 'CANCELLED' &&
      cents(b.cancellation_refund_amount ?? 0) !== sum(refunds, 'amount'));
  }
  for (const g of rows.departure_groups) {
    const groupBookings = bookings.filter(b => b.departure_group_id === g.id);
    const booked = groupBookings.filter(b => ['CONFIRMED', 'DEPOSIT_PENDING'].includes(b.booking_status)).reduce((n, b) => n + b.traveller_count, 0);
    const held = groupBookings.filter(b => b.booking_status === 'HELD').reduce((n, b) => n + b.traveller_count, 0);
    count('seat_counter_mismatch', booked !== g.booked_seats || held !== g.held_seats || booked + held > g.capacity);
  }
  for (const room of rows.departure_group_rooms) {
    const assigned = rows.departure_group_room_assignments.filter(a => a.room_id === room.id).length;
    count('room_counter_mismatch', assigned !== room.assigned_pilgrim_count || assigned > room.occupancy_capacity);
  }
  for (const f of rows.departure_group_flights.filter(f => f.direction === 'OUTBOUND')) {
    const countTicketed = rows.departure_group_pilgrims.filter(p => p.departure_group_id === f.departure_group_id &&
      p.flight_status === 'TICKETED' && !p.excluded_from_group_flight && bookings.some(b => b.id === p.booking_id &&
        !['CANCELLED', 'WAITLIST', 'HELD'].includes(b.booking_status))).length;
    count('outbound_ticket_counter_candidate', f.seats_ticketed !== countTicketed);
  }
  for (const invoice of rows.invoices) {
    const lines = rows.invoice_line_items.filter(l => l.invoice_id === invoice.id);
    count('invoice_without_lines', lines.length === 0 && cents(invoice.amount) !== 0);
    count('invoice_header_line_mismatch', lines.length > 0 && sum(lines, 'line_total') !== cents(invoice.amount));
  }
  for (const [name, children] of Object.entries({ payment: payments, milestone: milestones, refund: rows.refund_requests, invoice: rows.invoices })) {
    findings[`${name}_group_or_tenant_candidate`] = 0;
    for (const child of children) {
      const b = bookings.find(b => b.id === child.booking_id);
      count(`${name}_group_or_tenant_candidate`, Boolean(b && (child.departure_group_id !== b.departure_group_id || child.agency_id !== b.agency_id)));
    }
  }
  for (const allocation of rows.payment_allocations) {
    const p = payments.find(p => p.id === allocation.payment_id);
    const m = milestones.find(m => m.id === allocation.milestone_id);
    count('allocation_booking_mismatch', !p || !m || p.booking_id !== m.booking_id || p.agency_id !== m.agency_id);
  }
  for (const p of payments.filter(p => p.status === 'COMPLETED')) {
    count('allocation_exceeds_payment', sum(rows.payment_allocations.filter(a => a.payment_id === p.id), 'amount') > cents(p.amount));
  }
  // Include zeros for empty tables too; missing checks must not mean "not run".
  for (const name of ['missing_active_milestones','schedule_value_mismatch','multiple_payment_currencies',
    'booking_ledger_mismatch','cancelled_booking_has_debt','refund_flag_request_mismatch','refund_exceeds_held_money','cancellation_refund_projection_mismatch',
    'seat_counter_mismatch','room_counter_mismatch','outbound_ticket_counter_candidate','invoice_without_lines',
    'invoice_header_line_mismatch','allocation_booking_mismatch','allocation_exceeds_payment']) findings[name] ??= 0;
  return findings;
}
