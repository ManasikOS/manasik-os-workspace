do $$
begin
  alter view public.report_group_facts set (security_invoker = true);
  comment on view public.report_group_facts is
    'Currency-aware report facts; supplier cost buckets preserve cross-currency totals without unsafe conversion.';
end;
$$;
