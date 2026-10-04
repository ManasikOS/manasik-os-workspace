/** Read-only API inventory. No SQL execution, login, writes or customer rows. */
import nextEnv from '@next/env';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { projection, reconcile } from './departure-reconcile.mjs';

nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const tables = [
  'departure_groups', 'departure_group_bookings', 'departure_group_pricing',
  'departure_group_pilgrims', 'departure_group_pilgrim_charges',
  'departure_group_room_assignments', 'departure_group_flights',
  'booking_payment_milestones', 'pilgrim_payment_milestones', 'payments',
  'payment_allocations', 'invoices', 'invoice_line_items', 'refund_requests',
  'supplier_commitments', 'supplier_payments', 'departure_group_costing',
];
const report = {
  capturedAt: new Date().toISOString(),
  scope: 'Aggregate counts only, privileged API identity. Not a tenant-isolation test.',
  localMigrations: [],
  apiInventory: [],
  reconciliation: { verified: false, counts: null, consistency: 'Sequential API reads, not a transaction snapshot. Confirm candidates with the SQL audit.' },
  unverified: ['applied migrations', 'view ownership/options', 'SQL grants/policies/triggers',
    'numeric precision/defaults/constraints', 'tenant/role isolation', 'SQL reconciliation counts'],
};
for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  report.localMigrations.push({ file, sha256: createHash('sha256').update(await readFile(`supabase/migrations/${file}`)).digest('hex') });
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('An existing Supabase URL and server key are required; no secrets are logged.');
const base = new URL(url);
if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) {
  throw new Error('Refusing to send credentials to a non-HTTPS remote endpoint.');
}
// Sequential bounded HEAD requests; no customer names or contact fields are requested.
for (const table of tables) {
  const endpoint = new URL(`/rest/v1/${table}`, base);
  endpoint.searchParams.set('select', '*');
  try {
    const response = await fetch(endpoint, {
      method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
    });
    const raw = response.headers.get('content-range')?.split('/')[1];
    const count = response.ok && raw && /^\d+$/.test(raw) ? Number(raw) : null;
    report.apiInventory.push({ table, httpStatus: response.status, count, verified: count !== null });
  } catch {
    // Do not serialize exception details that might contain endpoint or credentials.
    report.apiInventory.push({ table, count: null, verified: false, error: 'Request failed or timed out' });
  }
}
// Only minimal IDs/state/amount fields enter memory. Persist only aggregate counts.
try {
  const rows = {};
  for (const [table, select] of Object.entries(projection)) {
    rows[table] = [];
    let complete = false;
    for (let offset = 0; offset < 100000; offset += 500) {
      const endpoint = new URL(`/rest/v1/${table}`, base);
      endpoint.searchParams.set('select', select);
      endpoint.searchParams.set('order', 'id.asc');
      endpoint.searchParams.set('offset', String(offset));
      endpoint.searchParams.set('limit', '500');
      const response = await fetch(endpoint, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' } });
      if (!response.ok) throw new Error('Projection unavailable');
      const page = await response.json();
      const total = Number(response.headers.get('content-range')?.split('/')[1]);
      if (!Array.isArray(page) || !Number.isFinite(total)) throw new Error('Incomplete projection');
      rows[table].push(...page);
      if (rows[table].length >= total) { complete = true; break; }
      // Refuse silent truncation if the API row limit is below our page size.
      if (page.length !== 500) throw new Error('Unexpected pagination limit');
    }
    if (!complete) throw new Error('Audit size cap reached');
  }
  report.reconciliation.counts = reconcile(rows);
  report.reconciliation.verified = true;
} catch {
  report.reconciliation.error = 'Minimal projection read failed; reconciliation is unknown, not zero.';
}
const output = 'docs/departure-groups-phase-a-api-inventory.json';
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
const failures = report.apiInventory.filter(r => !r.verified).length;
console.log(`Saved ${output}; ${report.apiInventory.length - failures}/${tables.length} API counts verified. SQL inventory remains unverified.`);
if (failures || !report.reconciliation.verified) process.exitCode = 1;
