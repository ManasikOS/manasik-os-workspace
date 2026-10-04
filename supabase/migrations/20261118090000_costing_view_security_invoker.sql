-- Ensure direct API reads of costing rows are evaluated with the caller's RLS
-- permissions instead of the view owner's privileges.
alter view public.departure_group_costing set (security_invoker = true);
