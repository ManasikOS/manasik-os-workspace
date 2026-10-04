import { describe, expect, it } from "vitest";

import { findDuplicateTransaction, type DuplicateCheckTransaction } from "./duplicate-transaction";

function tx(overrides: Partial<DuplicateCheckTransaction>): DuplicateCheckTransaction {
  return { id: "a", reference: "TRX001", amount: 1000, statementDate: "2026-09-10", ...overrides };
}

describe("findDuplicateTransaction", () => {
  it("flags a same reference + amount within the window as a duplicate", () => {
    const existing = [tx({ id: "existing", statementDate: "2026-09-08" })];
    expect(findDuplicateTransaction(tx({ id: "new" }), existing)).toBe("existing");
  });

  it("does not flag when the reference differs", () => {
    const existing = [tx({ id: "existing", reference: "TRX002" })];
    expect(findDuplicateTransaction(tx({ id: "new" }), existing)).toBeNull();
  });

  it("does not flag when the amount differs", () => {
    const existing = [tx({ id: "existing", amount: 2000 })];
    expect(findDuplicateTransaction(tx({ id: "new" }), existing)).toBeNull();
  });

  it("does not flag outside the day window", () => {
    const existing = [tx({ id: "existing", statementDate: "2026-08-01" })];
    expect(findDuplicateTransaction(tx({ id: "new" }), existing)).toBeNull();
  });

  it("does not flag a transaction against itself", () => {
    const self = tx({ id: "same" });
    expect(findDuplicateTransaction(self, [self])).toBeNull();
  });

  it("ignores rows with no reference at all", () => {
    const existing = [tx({ id: "existing", reference: null })];
    expect(findDuplicateTransaction(tx({ id: "new", reference: null }), existing)).toBeNull();
  });
});
