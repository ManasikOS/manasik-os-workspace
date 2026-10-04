-- MI2.3 — the S0 gate log gets its closed reason list.
--
-- inbox_gate_decisions (MI0.3) took `reason` as free text "until MI2.3 constrains it to the GateReason list once that
-- list exists in code". It exists now: GATE_REASONS in lib/inbox/intelligence/contracts.ts. This mirrors it, and adds the
-- invariant the KPI view relies on — a row's decision and its reason must agree, so a skip can never be logged without
-- a skip reason (inbox_gate_skip_reasons groups by exactly these).
--
-- The table is empty at the time of writing (nothing writes to it before MI2.4), so the constraints validate immediately.

alter table public.inbox_gate_decisions drop constraint if exists inbox_gate_decisions_reason_check;
alter table public.inbox_gate_decisions
  add constraint inbox_gate_decisions_reason_check check (reason in (
    'ENRICH_NEW_CONVERSATION', 'ENRICH_NEW_MESSAGE',
    'SKIP_SURFACE_OFF', 'SKIP_ENTITLEMENT_EXHAUSTED', 'SKIP_SPAM', 'SKIP_CLOSED',
    'SKIP_HUMAN_ACTIVE', 'SKIP_UNCHANGED_INPUT', 'SKIP_ACKNOWLEDGEMENT'));

alter table public.inbox_gate_decisions drop constraint if exists inbox_gate_decisions_decision_matches_reason;
alter table public.inbox_gate_decisions
  add constraint inbox_gate_decisions_decision_matches_reason check (
    (decision = 'ENRICH' and reason like 'ENRICH\_%' escape '\')
    or (decision = 'SKIP' and reason like 'SKIP\_%' escape '\'));
