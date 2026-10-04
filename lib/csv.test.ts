import { describe, expect, it } from "vitest";

import { parseCsv, toCsv } from "./csv";

describe("toCsv", () => {
  it("prefixes formula-injection-prone leading characters with a quote", () => {
    const csv = toCsv([
      ["Header"],
      ["=SUM(A1:A2)", "+1", "-1", "@cmd", "\tHi", "plain"],
    ]);
    const dataLine = csv.split("\r\n")[1];
    const cells = dataLine.split(",");
    expect(cells[0]).toBe("'=SUM(A1:A2)");
    expect(cells[1]).toBe("'+1");
    expect(cells[2]).toBe("'-1");
    expect(cells[3]).toBe("'@cmd");
    expect(cells[4]).toBe("'\tHi");
    expect(cells[5]).toBe("plain");
  });

  it("quotes fields containing commas, quotes or newlines and doubles embedded quotes", () => {
    const csv = toCsv([["Header"], ['Has "quotes"', "Has,comma", "Has\nnewline"]]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toBe('"Has ""quotes"""' + ',"Has,comma","Has\nnewline"');
  });

  it("leaves an already-quote-prefixed formula-like value alone (does not double-prefix)", () => {
    // A field that itself starts with a quote is not formula-injection-prone —
    // the prefix check only looks at =, +, -, @ and control chars.
    const csv = toCsv([["Header"], ['"already quoted']]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine.startsWith("'")).toBe(false);
  });

  it("prepends a UTF-8 BOM so Excel renders non-Latin text correctly", () => {
    const csv = toCsv([["a"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
});

describe("parseCsv", () => {
  it("round-trips a matrix through toCsv, including quoted and comma-bearing fields", () => {
    const matrix = [
      ["Code", "Title", "Notes"],
      ["PKG-1", "Ramadan Umrah", 'Has "quotes", a comma, and text'],
    ];
    const parsed = parseCsv(toCsv(matrix));
    expect(parsed).toEqual(matrix);
  });

  it("strips a leading BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles both \\n and \\r\\n line endings", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops blank lines so a trailing newline doesn't yield a phantom row", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
