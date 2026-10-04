import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const traceability = readFileSync(path.resolve(process.cwd(), "docs/inbox/traceability.md"), "utf8");
const databaseVerification = readFileSync(path.resolve(process.cwd(), "scripts/sql/verify-fix12-inbox-security.sql"), "utf8");

describe("FIX12 traceability — G1–G15", () => {
  it.each(Array.from({ length: 15 }, (_, index) => `G${index + 1}`))("names %s", (id) => expect(traceability).toContain(`| ${id} |`));
});

describe("FIX12 traceability — R1–R7", () => {
  it.each(Array.from({ length: 7 }, (_, index) => `R${index + 1}`))("names %s", (id) => expect(traceability).toContain(`| ${id} |`));
});

it("keeps the database verification transactional and security-focused", () => {
  expect(databaseVerification).toContain("begin;");
  expect(databaseVerification).toContain("rollback;");
  expect(databaseVerification).toContain("rls_missing");
  expect(databaseVerification).toContain("invoker_views_missing");
  expect(databaseVerification).toContain("missing_source_composite_fks");
});
