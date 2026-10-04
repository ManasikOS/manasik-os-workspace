import { describe, expect, it } from "vitest";

import { customerMessage, facts, MESSAGE_ID } from "../fixtures";
import { detectBankDetailMismatch } from "./bank-detail-mismatch";

const said = (text: string, approvedAccounts: string[] = []) => detectBankDetailMismatch(facts({ latest: customerMessage(text), approvedAccounts }));

describe("BANK_DETAIL_MISMATCH", () => {
  it("fires on a digit sequence absent from the approved list", () => {
    const finding = said("Please send to this bank account 8001 2345 6789", ["123456789012"]);
    expect(finding).toMatchObject({ code: "BANK_DETAIL_MISMATCH", messageId: MESSAGE_ID });
  });

  it("does not fire on an approved account, however it is spaced or hyphenated", () => {
    expect(said("our account 1234 5678 9012 right?", ["123456789012"])).toBeNull();
    expect(said("bank a/c 1234-5678-9012", ["123456789012"])).toBeNull();
  });

  it("fires for every account number when the agency has approved none yet", () => {
    expect(said("transfer to account 123456789012")).not.toBeNull();
  });

  it("near-miss: a number that is not next to a bank word, or too short to be an account, is ignored", () => {
    expect(said("my whatsapp is 0771234567 call me", ["123456789012"])).toBeNull();
    expect(said("bank account 12345", ["123456789012"])).toBeNull();
    expect(said("please confirm the account holder name", ["123456789012"])).toBeNull();
  });

  it("negative: no message, and an unrelated one", () => {
    expect(detectBankDetailMismatch(facts())).toBeNull();
    expect(said("Any December packages?")).toBeNull();
  });
});
