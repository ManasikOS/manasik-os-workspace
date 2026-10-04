import { describe, expect, it } from "vitest";

import { DIGEST_TOKEN_BUDGET, DIGEST_TURN_MAX_CHARS, buildDigest, estimateTokens, updateDigest, type DigestTurn } from "./digest";

const turn = (speaker: DigestTurn["speaker"], text: string): DigestTurn => ({ speaker, text });

describe("estimateTokens", () => {
  it("counts Sinhala and Tamil far heavier than English of the same length", () => {
    const english = "a".repeat(60);
    expect(estimateTokens("උ".repeat(60))).toBeGreaterThan(estimateTokens(english) * 2);
    expect(estimateTokens("உ".repeat(60))).toBeGreaterThan(estimateTokens(english) * 2);
  });
});

describe("digest", () => {
  it("labels who spoke and skips empty turns", () => {
    expect(buildDigest([turn("customer", "Any Umrah packages?"), turn("team", "  "), turn("team", "Yes, three.")])).toBe("C: Any Umrah packages?\nT: Yes, three.");
    expect(buildDigest([])).toBeNull();
    expect(updateDigest(null, [turn("customer", "   ")])).toBeNull();
  });

  it("is incremental: appending a turn to the previous digest equals building from all turns", () => {
    const first = [turn("customer", "Hi"), turn("team", "Salaam, how can we help?")];
    const next = [turn("customer", "Price for December?")];
    expect(updateDigest(buildDigest(first), next)).toBe(buildDigest([...first, ...next]));
  });

  it("never exceeds the token budget, however long the conversation, in any of the three scripts", () => {
    for (const filler of ["Could you tell me about the package details please. ", "පැකේජ් එක ගැන විස්තර ටිකක් කියන්න පුළුවන්ද. ", "தயவுசெய்து பேக்கேஜ் விவரங்களை சொல்லுங்கள். "]) {
      let digest: string | null = null;
      for (let index = 0; index < 300; index += 1) digest = updateDigest(digest, [turn(index % 2 === 0 ? "customer" : "team", `${filler}${index}`)]);
      expect(estimateTokens(digest ?? "") + (digest ?? "").split("\n").length).toBeLessThanOrEqual(DIGEST_TOKEN_BUDGET + 1);
    }
  });

  it("drops the OLDEST turns first and always keeps the newest", () => {
    let digest: string | null = null;
    for (let index = 0; index < 200; index += 1) digest = updateDigest(digest, [turn("customer", `message number ${index} `.repeat(6))]);
    expect(digest).toContain("message number 199");
    expect(digest).not.toContain("message number 0 ");
  });

  it("caps one enormous message so it cannot evict the rest of the conversation", () => {
    const digest = buildDigest([turn("customer", "Earlier question about visas"), turn("customer", "x".repeat(50_000))]) ?? "";
    expect(digest).toContain("Earlier question about visas");
    expect(digest.split("\n")[1].length).toBeLessThanOrEqual(DIGEST_TURN_MAX_CHARS + 4);
  });

  it("keeps the newest turn even when the budget is smaller than that one turn", () => {
    expect(buildDigest([turn("customer", "old"), turn("customer", "a fairly long newest message here")], 2)).toBe("C: a fairly long newest message here");
  });
});
