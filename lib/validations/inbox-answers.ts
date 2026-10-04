import { z } from "zod";

export const approveInboxAnswerSchema = z.object({ answerId: z.string().uuid(), decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().max(500).optional() }).strict().refine((value) => value.decision === "APPROVE" || Boolean(value.reason), { message: "Say why this answer was rejected.", path: ["reason"] });
