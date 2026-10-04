import { describe, expect, it } from "vitest";

import { customerMessage, facts, MESSAGE_ID } from "../fixtures";
import { detectSensitiveDocReceived } from "./sensitive-doc-received";

const sent = (over: Parameters<typeof customerMessage>[1], text = "") => detectSensitiveDocReceived(facts({ latest: customerMessage(text, over) }));

describe("SENSITIVE_DOC_RECEIVED", () => {
  it("fires for a document whose file name is a passport", () => {
    expect(sent({ type: "DOCUMENT", attachmentName: "Fathima_passport.pdf" })).toMatchObject({ code: "SENSITIVE_DOC_RECEIVED", messageId: MESSAGE_ID });
    expect(sent({ type: "IMAGE", attachmentName: "NIC front.jpg" })).not.toBeNull();
    expect(sent({ type: "DOCUMENT", attachmentName: "bank-statement-aug.pdf" })).not.toBeNull();
  });

  it("fires from the caption when there is no file name", () => {
    expect(sent({ type: "IMAGE" }, "my passport copy")).not.toBeNull();
    expect(sent({ type: "IMAGE" }, "birth certificate of my son")).not.toBeNull();
  });

  it("near-miss: an ordinary photo or file is not sensitive", () => {
    expect(sent({ type: "IMAGE", attachmentName: "IMG_2041.jpg" })).toBeNull();
    expect(sent({ type: "DOCUMENT", attachmentName: "itinerary-request.pdf" })).toBeNull();
  });

  it("near-miss: a TEXT message that merely mentions a passport is not a document", () => {
    expect(sent({ type: "TEXT" }, "Do I need a passport for Umrah?")).toBeNull();
  });

  it("negative: no message", () => {
    expect(detectSensitiveDocReceived(facts())).toBeNull();
  });
});
