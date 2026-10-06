/**
 * Departure Groups tenant-isolation and role checks, run against a real (staging) project.
 *
 * Signs in as real test users through the public API, exactly as a browser would, and tries to do what it must not be able to do:
 * read another agency's rows, write to them, call the atomic-write function for them, read their files, edit the access log.
 * Prints PASS / FAIL / SKIP per check and exits 1 on any FAIL. A SKIP means the check could not be made (no data to test with,
 * a missing account) and is NOT a pass - read them.
 *
 * It is not the existing scripts/audits/departure-phase-a.mjs, which uses a server key and says itself it is "not a tenant-isolation test".
 *
 * Setup (staging only - see docs/runbooks/departure-groups-security-rollout.md, step 3):
 *   Two agencies, each with at least one departure group; an ADMIN user in each. Optional: a GUIDE in agency A who is assigned to one
 *   group but not another, and a MARKETING user in agency A.
 *
 *   CHECK_SUPABASE_URL, CHECK_SUPABASE_ANON_KEY            the project's public URL and anon (publishable) key
 *   CHECK_A_EMAIL, CHECK_A_PASSWORD                        admin in agency A
 *   CHECK_B_EMAIL, CHECK_B_PASSWORD                        admin in agency B
 *   CHECK_GUIDE_EMAIL, CHECK_GUIDE_PASSWORD                (optional) guide in agency A
 *   CHECK_NONADMIN_EMAIL, CHECK_NONADMIN_PASSWORD          (optional) any non-admin in agency A, e.g. marketing
 *   CHECK_I_AM_NOT_PRODUCTION=yes                          required: you are saying this is not the live project
 *
 *   node scripts/audits/departure-security-check.mjs
 *
 * Writes: every write attempt is one that must be refused, using values that change nothing. If one unexpectedly succeeds the script
 * reports FAIL and removes what it created. The one thing it leaves behind is a single, clearly labelled row in the append-only
 * document access log (only when no real row exists to test with); the 24-month retention sweep removes it in time.
 * The script never prints a password, a token, a file name or a customer value - counts and ids only.
 */
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import {
  FAIL, PASS, SKIP, errorCode, exitCodeFor, foreignAgencyRows, insertOutcome, looksLikeProduction, result, summarise, valuesOutside, writeWasRefused,
} from './departure-security-checks.mjs';

nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const env = process.env;

const url = env.CHECK_SUPABASE_URL;
const anonKey = env.CHECK_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error('CHECK_SUPABASE_URL and CHECK_SUPABASE_ANON_KEY are required.');
if (env.CHECK_I_AM_NOT_PRODUCTION !== 'yes') throw new Error('Set CHECK_I_AM_NOT_PRODUCTION=yes to confirm this is not the live project.');
if (looksLikeProduction(url, env)) throw new Error('That URL looks like production. Refusing to run. Use a staging project.');
if (new URL(url).protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  throw new Error('Refusing to send credentials to a non-HTTPS endpoint.');
}

const results = [];
const record = (id, title, status, detail = '') => {
  results.push(result(id, title, status, detail));
  console.log(`${status.padEnd(4)} ${id}  ${title}${detail ? `  (${detail})` : ''}`);
};

const newClient = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** Signs in and returns { client, userId, agencyId, role } - or null when the account is not configured. */
async function signIn(label, emailVar, passwordVar) {
  const email = env[emailVar];
  const password = env[passwordVar];
  if (!email || !password) return null;
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    record(`LOGIN-${label}`, `sign in as ${label}`, FAIL, 'sign-in refused - check the account and password');
    return null;
  }
  const { data: profile, error: profileError } = await client.from('staff_profiles').select('agency_id, role').eq('id', data.user.id).maybeSingle();
  if (profileError || !profile?.agency_id) {
    record(`LOGIN-${label}`, `read ${label}'s staff profile`, FAIL, 'no agency on this account');
    return null;
  }
  return { client, userId: data.user.id, agencyId: profile.agency_id, role: profile.role };
}

// Tables that carry agency_id. A missing column or table is reported as SKIP, not hidden.
const TENANT_TABLES = [
  'departure_groups', 'departure_group_bookings', 'departure_group_pilgrims', 'departure_group_pricing',
  'departure_group_cost_estimates', 'departure_group_pilgrim_documents', 'departure_group_activity_logs',
  'departure_group_tasks', 'departure_group_flights', 'departure_group_accommodations', 'departure_group_transports',
  'departure_group_readiness_items', 'departure_group_pilgrim_charges', 'departure_group_pilgrim_deviations',
  'departure_group_document_access_log', 'booking_payment_milestones', 'payments', 'invoices',
];

const A = await signIn('A', 'CHECK_A_EMAIL', 'CHECK_A_PASSWORD');
const B = await signIn('B', 'CHECK_B_EMAIL', 'CHECK_B_PASSWORD');
if (!A || !B) {
  console.log('\nBoth agency admins (A and B) are required for the tenant checks. Nothing further was run.');
  process.exit(1);
}
if (A.agencyId === B.agencyId) {
  record('SETUP', 'A and B must be in different agencies', FAIL, 'both accounts resolve to the same agency');
  process.exit(1);
}
const guide = await signIn('GUIDE', 'CHECK_GUIDE_EMAIL', 'CHECK_GUIDE_PASSWORD');
const nonAdmin = await signIn('NONADMIN', 'CHECK_NONADMIN_EMAIL', 'CHECK_NONADMIN_PASSWORD');

/* ── T1: signed out ───────────────────────────────────────────────────────── */
{
  const anon = newClient();
  const leaked = [];
  for (const table of ['departure_groups', 'departure_group_bookings', 'departure_group_pilgrims', 'departure_group_pricing', 'departure_group_cost_estimates']) {
    const { data } = await anon.from(table).select('agency_id').limit(5);
    if ((data ?? []).length > 0) leaked.push(table);
  }
  record('T1', 'signed-out visitor reads no departure data', leaked.length === 0 ? PASS : FAIL, leaked.length ? `readable: ${leaked.join(', ')}` : '');
}

/* ── T2: each agency reads only its own rows ──────────────────────────────── */
for (const [label, who] of [['A', A], ['B', B]]) {
  for (const table of TENANT_TABLES) {
    const { data, error } = await who.client.from(table).select('agency_id').limit(1000);
    const id = `T2-${label}-${table}`;
    if (error) {
      record(id, `${label} reads ${table}`, SKIP, `query failed (${errorCode(error) ?? 'error'}): table or column missing, or no access`);
      continue;
    }
    const foreign = foreignAgencyRows(data, who.agencyId);
    if (foreign.length === 0 && (data ?? []).length === 0) {
      // Reading nothing proves nothing: the table may simply be empty for this agency.
      record(id, `${label} sees only its own ${table}`, SKIP, 'no rows visible, so there was nothing to leak; add data to this agency to test it');
      continue;
    }
    record(id, `${label} sees only its own ${table}`, foreign.length === 0 ? PASS : FAIL, `${(data ?? []).length} rows read, ${foreign.length} foreign`);
  }
}

/* ── T3: the costing view ─────────────────────────────────────────────────── */
for (const [label, who] of [['A', A], ['B', B]]) {
  const { data: groups, error: groupsError } = await who.client.from('departure_groups').select('id').limit(2000);
  const { data: costing, error: costingError } = await who.client.from('departure_group_costing').select('departure_group_id').limit(2000);
  const id = `T3-${label}`;
  if (groupsError || costingError) {
    record(id, `${label} reads the costing view`, SKIP, 'view or groups not readable');
    continue;
  }
  const outside = valuesOutside(costing, 'departure_group_id', new Set((groups ?? []).map((g) => g.id)));
  if (outside.length === 0 && (costing ?? []).length === 0) {
    record(id, `${label}'s costing view shows only groups ${label} can see`, SKIP, 'the view returned no rows, so there was nothing to leak');
    continue;
  }
  record(id, `${label}'s costing view shows only groups ${label} can see`, outside.length === 0 ? PASS : FAIL, `${(costing ?? []).length} rows, ${outside.length} outside`);
}

/* ── T4: cannot write into the other agency ───────────────────────────────── */
const { data: bGroups } = await B.client.from('departure_groups').select('id, group_name').limit(1);
const bGroup = bGroups?.[0];
if (!bGroup) {
  record('T4', 'A cannot write to B\'s group', SKIP, 'agency B has no departure group to test with');
} else {
  // Update to the value it already has: changes nothing even if it were allowed.
  const upd = await A.client.from('departure_groups').update({ group_name: bGroup.group_name }).eq('id', bGroup.id).select('id');
  record('T4-update', 'A cannot update B\'s group', writeWasRefused({ error: upd.error, rowsAffected: upd.data }) ? PASS : FAIL);

  const ins = await A.client.from('departure_group_tasks').insert({
    departure_group_id: bGroup.id, title: 'security-check probe', owner_name: 'probe', due_at: new Date().toISOString(), category: 'OTHER',
  }).select('id');
  const outcome = insertOutcome({ error: ins.error, rowsCreated: ins.data });
  record('T4-insert', 'A cannot add a task to B\'s group', outcome.status, outcome.detail);
  if (outcome.status === FAIL) {
    // Clean up what should never have been created, using B's own session.
    for (const row of ins.data ?? []) await B.client.from('departure_group_tasks').delete().eq('id', row.id);
  }
}

/* ── T5: the atomic-write function ────────────────────────────────────────── */
{
  const spoof = await A.client.rpc('apply_departure_store_changes_atomic_v2', {
    p_changes: {}, p_deletes: {}, p_agency_id: B.agencyId, p_new_booking_ids: [], p_expected_versions: {},
  });
  record('T5-spoof', 'A cannot run the atomic write as agency B', spoof.error && errorCode(spoof.error) === '42501' ? PASS : FAIL, spoof.error ? `code ${errorCode(spoof.error) ?? 'none'}` : 'it ran');

  const { data: ownBookings } = await A.client.from('departure_group_bookings').select('id, row_version').limit(1);
  const booking = ownBookings?.[0];
  if (!booking) {
    record('T5-version', 'a stale booking version is refused', SKIP, 'agency A has no booking to test with');
  } else {
    const stale = await A.client.rpc('apply_departure_store_changes_atomic_v2', {
      p_changes: {}, p_deletes: {}, p_agency_id: A.agencyId, p_new_booking_ids: [], p_expected_versions: { [booking.id]: booking.row_version - 1 },
    });
    record('T5-version', 'a stale booking version is refused with 40001 and nothing written', errorCode(stale.error) === '40001' ? PASS : FAIL, `code ${errorCode(stale.error) ?? 'none'}`);
  }
}

/* ── T6: another agency's files ───────────────────────────────────────────── */
if (!bGroup) {
  record('T6', 'A cannot list B\'s traveller files', SKIP, 'agency B has no group');
} else {
  const prefix = `${B.agencyId}/${bGroup.id}`;
  const mine = await B.client.storage.from('pilgrim-documents').list(prefix, { limit: 5 });
  if (mine.error || (mine.data ?? []).length === 0) {
    record('T6', 'A cannot list B\'s traveller files', SKIP, 'B has no uploaded files under its first group, so there is nothing A could wrongly see');
  } else {
    const theirs = await A.client.storage.from('pilgrim-documents').list(prefix, { limit: 5 });
    record('T6', 'A cannot list B\'s traveller files', (theirs.data ?? []).length === 0 ? PASS : FAIL, `B sees ${mine.data.length}, A sees ${(theirs.data ?? []).length}`);
  }
}

/* ── T7: the access log is append-only and admin-readable ─────────────────── */
{
  const probe = { agency_id: A.agencyId, staff_id: A.userId, staff_name: 'departure-security-check', file_path: `${A.agencyId}/probe/probe/probe.pdf`, action: 'VIEW' };
  let { data: rows } = await A.client.from('departure_group_document_access_log').select('id').limit(1);
  let target = rows?.[0]?.id;
  if (!target) {
    const created = await A.client.from('departure_group_document_access_log').insert(probe).select('id');
    target = created.data?.[0]?.id;
    if (!target) record('T7-insert', 'admin can write its own access-log row', SKIP, 'insert refused; the migration may not be applied');
  }
  if (target) {
    const upd = await A.client.from('departure_group_document_access_log').update({ staff_name: 'tampered' }).eq('id', target).select('id');
    record('T7-update', 'access-log rows cannot be edited', writeWasRefused({ error: upd.error, rowsAffected: upd.data }) ? PASS : FAIL);
    const del = await A.client.from('departure_group_document_access_log').delete().eq('id', target).select('id');
    record('T7-delete', 'access-log rows cannot be deleted', writeWasRefused({ error: del.error, rowsAffected: del.data }) ? PASS : FAIL);
  }
  const spoofed = await A.client.from('departure_group_document_access_log').insert({ ...probe, staff_id: randomUUID() }).select('id');
  const spoofOutcome = insertOutcome({ error: spoofed.error, rowsCreated: spoofed.data });
  record('T7-spoof', 'a log row cannot be written in someone else\'s name', spoofOutcome.status, spoofOutcome.detail);
  const crossAgency = await A.client.from('departure_group_document_access_log').insert({ ...probe, agency_id: B.agencyId }).select('id');
  const agencyOutcome = insertOutcome({ error: crossAgency.error, rowsCreated: crossAgency.data });
  record('T7-agency', 'a log row cannot be written for another agency', agencyOutcome.status, agencyOutcome.detail);

  if (nonAdmin) {
    const seen = await nonAdmin.client.from('departure_group_document_access_log').select('id').limit(5);
    record('T7-read', `a non-admin (${nonAdmin.role}) cannot read the access log`, (seen.data ?? []).length === 0 ? PASS : FAIL, `${(seen.data ?? []).length} rows visible`);
  } else {
    record('T7-read', 'a non-admin cannot read the access log', SKIP, 'no CHECK_NONADMIN account configured');
  }
}

/* ── T8: a guide only reaches assigned groups ─────────────────────────────── */
if (!guide) {
  record('T8', 'guide scope', SKIP, 'no CHECK_GUIDE account configured');
} else if (guide.agencyId !== A.agencyId) {
  record('T8', 'guide scope', FAIL, 'the guide account is not in agency A');
} else {
  const { data: assigned } = await guide.client.from('staff_group_assignments').select('departure_group_id').eq('staff_profile_id', guide.userId).is('unassigned_at', null);
  const assignedIds = new Set((assigned ?? []).map((row) => row.departure_group_id));
  const { data: visible } = await guide.client.from('departure_groups').select('id').limit(2000);
  const outside = valuesOutside(visible, 'id', assignedIds);
  record('T8-read', 'a guide sees only assigned groups', outside.length === 0 ? PASS : FAIL, `${(visible ?? []).length} visible, ${assignedIds.size} assigned, ${outside.length} outside`);

  const { data: allA } = await A.client.from('departure_groups').select('id').limit(2000);
  const notAssigned = (allA ?? []).find((g) => !assignedIds.has(g.id));
  if (!notAssigned) {
    record('T8-write', 'a guide cannot add a task to an unassigned group', SKIP, 'every group in agency A is assigned to the guide');
  } else {
    const ins = await guide.client.from('departure_group_tasks').insert({
      departure_group_id: notAssigned.id, title: 'security-check probe', owner_name: 'probe', due_at: new Date().toISOString(), category: 'OTHER',
    }).select('id');
    const outcome = insertOutcome({ error: ins.error, rowsCreated: ins.data });
    record('T8-write', 'a guide cannot add a task to an unassigned group', outcome.status, outcome.detail);
    if (outcome.status === FAIL) for (const row of ins.data ?? []) await A.client.from('departure_group_tasks').delete().eq('id', row.id);
  }
}

/* ── Summary ──────────────────────────────────────────────────────────────── */
const { pass, fail, skip } = summarise(results);
console.log(`\n${pass} passed, ${fail} FAILED, ${skip} skipped.`);
if (skip > 0) console.log('Skipped checks were NOT made. Add the missing accounts or data and run again before calling the result clean.');
if (fail > 0) console.log('Any FAIL is a release blocker: fix it before this goes live.');
process.exit(exitCodeFor(results));
