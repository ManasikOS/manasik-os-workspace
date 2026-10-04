import { describe, expect, it } from "vitest";
import { bucketPipelineValue } from "./pipeline-value";

describe("pipeline value", () => {
  it("buckets currencies without accepting or applying an FX rate", () => expect(bucketPipelineValue([{ currency: "USD", amountCents: 100 }, { currency: "LKR", amountCents: 200 }, { currency: "USD", amountCents: 300 }], "LKR")).toEqual([{ currency: "LKR", amountCents: 200, label: "LKR estimate", queueCode: "QUALIFIED" }, { currency: "USD", amountCents: 400, label: "USD estimate", queueCode: "QUALIFIED" }]));
  it("renders a single currency as exactly one estimate", () => expect(bucketPipelineValue([{ currency: "LKR", amountCents: 200 }], "LKR")).toHaveLength(1));
});
