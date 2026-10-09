import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/utils/supabase/server", () => ({ createClient: () => ({}) }));

import { formDataToRow } from "@/app/(main)/packages/create-package/mappers";
import { INITIAL_PACKAGE_FORM_DATA } from "@/app/(main)/packages/create-package/types";
import type { PackageRow } from "@/lib/types/database";

import { applyPublishedTerms, loadTemplateDefinition } from "./packages-template";

afterEach(() => vi.restoreAllMocks());

const VERSION_ID = "33333333-3333-4333-8333-333333333333";

function liveRow(overrides: Record<string, unknown> = {}): PackageRow {
  return {
    ...formDataToRow({
      ...INITIAL_PACKAGE_FORM_DATA,
      title: "Ramadan Umrah (corrected)",
      cancellationPolicy: "LIVE cancellation text",
      paymentTerms: "LIVE payment terms",
      defaultCapacity: 99,
    }),
    id: "11111111-1111-4111-8111-111111111111",
    status: "Open for Sale",
    featured: false,
    owner_id: "x",
    published_version_id: VERSION_ID,
    ...overrides,
  } as unknown as PackageRow;
}

const approvedSnapshot = {
  title: "Ramadan Umrah (old typo)",
  cancellation_policy: "APPROVED cancellation text",
  payment_terms: "APPROVED payment terms",
  default_capacity: 40,
  status: "Archived",
  owner_id: "someone else",
  not_a_column: true,
};

describe("applyPublishedTerms", () => {
  it("takes the payment, contract and booking terms from the version and the display text from the live row", () => {
    const merged = applyPublishedTerms(liveRow(), approvedSnapshot) as unknown as Record<string, unknown>;
    expect(merged.cancellation_policy).toBe("APPROVED cancellation text");
    expect(merged.payment_terms).toBe("APPROVED payment terms");
    expect(merged.default_capacity).toBe(40);
    expect(merged.title).toBe("Ramadan Umrah (corrected)");
  });

  it("never copies status, ownership or an unknown key from the snapshot", () => {
    const merged = applyPublishedTerms(liveRow(), approvedSnapshot) as unknown as Record<string, unknown>;
    expect(merged.status).toBe("Open for Sale");
    expect(merged.owner_id).toBe("x");
    expect(merged).not.toHaveProperty("not_a_column");
  });

  it("leaves the live row alone for a snapshot that is not an object, and for columns it lacks", () => {
    const live = liveRow();
    expect(applyPublishedTerms(live, null)).toBe(live);
    expect(applyPublishedTerms(live, "nope")).toBe(live);
    expect(applyPublishedTerms(live, [1])).toBe(live);
    const merged = applyPublishedTerms(live, { cancellation_policy: "only this" }) as unknown as Record<string, unknown>;
    expect(merged.payment_terms).toBe("LIVE payment terms");
    expect(merged.cancellation_policy).toBe("only this");
  });
});

function clientFor(row: PackageRow | null, version: { id: string; snapshot: unknown } | null) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === "packages" ? row : version, error: null }) }),
      }),
    }),
  } as never;
}

describe("loadTemplateDefinition", () => {
  it("builds the group's terms from the published version and records which version it used", async () => {
    const definition = await loadTemplateDefinition("p", clientFor(liveRow(), { id: VERSION_ID, snapshot: approvedSnapshot }));
    expect(definition?.cancellationPolicy).toBe("APPROVED cancellation text");
    expect(definition?.paymentTerms).toBe("APPROVED payment terms");
    expect(definition?.name).toBe("Ramadan Umrah (corrected)");
    expect(definition?.publishedVersionId).toBe(VERSION_ID);
  });

  it("uses the live row and records no version when the package was never published", async () => {
    const definition = await loadTemplateDefinition("p", clientFor(liveRow({ published_version_id: null, status: "Draft" }), null));
    expect(definition?.cancellationPolicy).toBe("LIVE cancellation text");
    expect(definition?.publishedVersionId).toBeNull();
  });

  it("falls back to the live row, without claiming a version, when the version cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const definition = await loadTemplateDefinition("p", clientFor(liveRow(), null));
    expect(definition?.cancellationPolicy).toBe("LIVE cancellation text");
    expect(definition?.publishedVersionId).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns null for a package that does not exist", async () => {
    expect(await loadTemplateDefinition("p", clientFor(null, null))).toBeNull();
  });
});
