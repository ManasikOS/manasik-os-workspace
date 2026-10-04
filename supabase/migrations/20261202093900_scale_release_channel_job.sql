-- Scaling track (docs/inbox/scaling.md §10): a tick that runs out of time must not spend a job's attempts.
--
-- `claim_channel_jobs` counts an attempt at claim time. When a worker's time budget ends with jobs still in flight,
-- the drain used to fail them through `fail_channel_job`, which keeps that attempt — so under a sustained backlog a
-- perfectly healthy job could be cut off three times and dead-lettered without ever faulting (measured: 221 of
-- 10,000 jobs, all "Exceeded the lane's time budget", in the 50-agency baseline run).
--
-- `release_channel_job` puts a job back on the queue immediately and gives the attempt back. Service role only,
-- and only for the worker that holds the lock, exactly like complete/fail.
create or replace function public.release_channel_job(p_id uuid, p_worker_id text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.channel_jobs
     set status = 'QUEUED',
         attempts = greatest(attempts - 1, 0),
         run_after = now(),
         last_error = left(coalesce(p_reason, 'released without penalty'), 2000),
         locked_at = null,
         locked_by = null
   where id = p_id and status = 'RUNNING' and locked_by = p_worker_id;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.release_channel_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.release_channel_job(uuid, text, text) to service_role;
