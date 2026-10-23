/** The four steps of the departure group editor: their labels and what each is for. */
export const GROUP_EDITOR_STEPS = [
  {
    id: "template",
    label: "Select Template",
    description: "Choose the package this group is created from.",
  },
  {
    id: "details",
    label: "Group Details",
    description: "Name, dates, capacity and owner. Everything else is copied.",
  },
  {
    id: "pricing",
    label: "Pricing & Flights",
    description: "This departure's own price, cost estimate and flight routing.",
  },
  {
    id: "review",
    label: "Review & Create",
    description: "Confirm everything before the group is created.",
  },
] as const;
