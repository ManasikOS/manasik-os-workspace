import { describe, expect, it } from "vitest";
import { createEmailOperationalEvent } from "./operational-events";
describe("email operational events", () => { it("records only safe event metadata", () => { const event = createEmailOperationalEvent({ agencyId: "agency-1", type: "SMTP_FAILURE", code: "AUTH_FAILED" }); expect(event).toEqual(expect.objectContaining({ type: "SMTP_FAILURE", code: "AUTH_FAILED" })); expect(event).not.toHaveProperty("recipient"); expect(event).not.toHaveProperty("body"); }); });
