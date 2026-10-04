do $$
begin
  revoke all on function public.apply_departure_store_changes_atomic(jsonb, jsonb, uuid, uuid[]) from public;
  grant execute on function public.apply_departure_store_changes_atomic(jsonb, jsonb, uuid, uuid[]) to authenticated;
  grant execute on function public.apply_departure_store_changes_atomic(jsonb, jsonb, uuid, uuid[]) to service_role;
  comment on function public.apply_departure_store_changes_atomic is
    'Applies a departure-group store diff in parent/child order inside one tenant-checked transaction.';
end;
$$;
