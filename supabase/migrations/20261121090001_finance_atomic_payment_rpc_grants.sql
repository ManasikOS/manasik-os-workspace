do $$
begin
  revoke all on function public.record_departure_booking_payment_atomic(uuid, uuid, numeric, text, text, text, text, text, timestamptz, text, jsonb, uuid, text) from public;
  grant execute on function public.record_departure_booking_payment_atomic(uuid, uuid, numeric, text, text, text, text, text, timestamptz, text, jsonb, uuid, text) to authenticated;
  comment on function public.record_departure_booking_payment_atomic is
    'Atomically posts an evidenced departure booking payment, allocations, booking balance, and held-seat promotion.';
end;
$$;
