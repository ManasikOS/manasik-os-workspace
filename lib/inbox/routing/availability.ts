import { z } from "zod";

export const STAFF_AVAILABILITY_KINDS = ["SHIFT", "LEAVE"] as const;
export type StaffAvailabilityKind = (typeof STAFF_AVAILABILITY_KINDS)[number];

export const staffAvailabilityInputSchema = z.object({
  staffId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  kind: z.enum(STAFF_AVAILABILITY_KINDS),
}).refine((input) => Date.parse(input.endsAt) > Date.parse(input.startsAt), {
  message: "The end must be after the start.",
  path: ["endsAt"],
});
export type StaffAvailabilityInput = z.infer<typeof staffAvailabilityInputSchema>;

export interface StaffAvailabilityRecord {
  id: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  kind: StaffAvailabilityKind;
}
