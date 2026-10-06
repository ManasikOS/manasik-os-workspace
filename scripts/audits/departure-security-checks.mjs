/**
 * Pure decision logic for scripts/audits/departure-security-check.mjs.
 *
 * Kept free of network and environment access so the rules that turn a response into PASS or FAIL are unit-tested
 * (scripts/audits/departure-security-checks.test.ts). The script itself only fetches and reports.
 */

/** Rows that belong to some other agency. A row with no agency counts as foreign: it should not be visible at all. */
export function foreignAgencyRows(rows, myAgencyId) {
  return (rows ?? []).filter((row) => !row || row.agency_id !== myAgencyId);
}

/** Values of `key` in `rows` that are not in `allowed` (a Set, or anything with .has). */
export function valuesOutside(rows, key, allowed) {
  return (rows ?? []).map((row) => row?.[key]).filter((value) => !allowed.has(value));
}

/**
 * Did the database refuse a write?
 * A refusal is either an error, or a "successful" call that changed no rows (row-level security hides the row from an
 * UPDATE or DELETE rather than raising). `rowsAffected` is what the call returned with `select()`.
 */
export function writeWasRefused({ error, rowsAffected }) {
  if (error) return true;
  return Array.isArray(rowsAffected) ? rowsAffected.length === 0 : false;
}

/**
 * What an INSERT that must be refused actually did.
 *
 * An insert can fail for reasons that say nothing about security (a missing required column, a bad value), and counting
 * those as "refused" would turn a broken test into a PASS. So an insert only passes when the database refused it BY POLICY
 * (SQLSTATE 42501, row-level security). Anything else is inconclusive and must be looked at.
 */
export function insertOutcome({ error, rowsCreated }) {
  if (Array.isArray(rowsCreated) && rowsCreated.length > 0) return { status: 'FAIL', detail: 'the insert succeeded' };
  if (error && error.code === '42501') return { status: 'PASS', detail: '' };
  if (error) return { status: 'SKIP', detail: `refused for another reason (code ${typeof error.code === 'string' ? error.code : 'none'}): the test payload may need updating, so this proves nothing` };
  return { status: 'SKIP', detail: 'no error and no row came back; cannot tell what happened' };
}

/** Postgres/PostgREST error code, if the error carries one. */
export function errorCode(error) {
  return error && typeof error.code === 'string' ? error.code : null;
}

/** True when the URL looks like a production project. The script refuses to run against one without an explicit override. */
export function looksLikeProduction(urlString, env = {}) {
  let host = '';
  try {
    host = new URL(urlString).hostname.toLowerCase();
  } catch {
    return true; // an unparseable URL is not something to run against
  }
  if (env.CHECK_PRODUCTION_HOST_PATTERN && new RegExp(env.CHECK_PRODUCTION_HOST_PATTERN, 'i').test(host)) return true;
  return /(^|[.-])(prod|production|live)([.-]|$)/.test(host);
}

export const PASS = 'PASS';
export const FAIL = 'FAIL';
export const SKIP = 'SKIP';

/** A result row. `detail` must never contain a credential, a token or customer data - counts and ids only. */
export function result(id, title, status, detail = '') {
  return { id, title, status, detail };
}

export function summarise(results) {
  const count = (status) => results.filter((r) => r.status === status).length;
  return { pass: count(PASS), fail: count(FAIL), skip: count(SKIP) };
}

/** Exit non-zero on any failure. A skip is not a pass, so the caller must read the skips. */
export function exitCodeFor(results) {
  return results.some((r) => r.status === FAIL) ? 1 : 0;
}
