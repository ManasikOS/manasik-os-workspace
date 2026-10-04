import { describe, expect, it } from "vitest";

import { parseBankStatementCsv } from "./bank-statement-csv";

describe("parseBankStatementCsv", () => {
  it("parses a signed-amount export", () => {
    const csv = [
      "date,description,reference,amount",
      "2026-09-01,Transfer from Jane Doe,TRX001,45000",
      "2026-09-02,Wire to ABC Travels,TRX002,-12000",
    ].join("\n");

    const { rows, errors } = parseBankStatementCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toEqual([
      { statementDate: "2026-09-01", description: "Transfer from Jane Doe", reference: "TRX001", amount: 45000 },
      { statementDate: "2026-09-02", description: "Wire to ABC Travels", reference: "TRX002", amount: -12000 },
    ]);
  });

  it("parses separate credit/debit columns", () => {
    const csv = [
      "date,description,credit,debit",
      "01/09/2026,Transfer from Jane Doe,45000,",
      "02/09/2026,Wire to ABC Travels,,12000",
    ].join("\n");

    const { rows, errors } = parseBankStatementCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ statementDate: "2026-09-01", amount: 45000 });
    expect(rows[1]).toMatchObject({ statementDate: "2026-09-02", amount: -12000 });
  });

  it("reports missing required columns", () => {
    const { rows, errors } = parseBankStatementCsv("foo,bar\n1,2");
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("skips unreadable lines but keeps the rest", () => {
    const csv = [
      "date,description,amount",
      "2026-09-01,Good line,1000",
      "not-a-date,Bad line,500",
    ].join("\n");

    const { rows, errors } = parseBankStatementCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("rejects an empty paste", () => {
    const { rows, errors } = parseBankStatementCsv("   ");
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });
});
