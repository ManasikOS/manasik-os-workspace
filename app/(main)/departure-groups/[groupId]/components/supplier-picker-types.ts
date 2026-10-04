/**
 * Which Supplier Directory types make sense for each field that links a
 * departure-group service to a supplier. A hotel picker has no business
 * offering an insurance broker — this is the one place that mapping lives,
 * so the accommodation/transport/flight dialogs and the Operations
 * "record supplier details" dialog all stay in agreement.
 *
 * BROKER is included everywhere: an agency may route any of these bookings
 * through a general broker rather than the hotel/transport company directly.
 */
export const SUPPLIER_TYPES_BY_CONTEXT = {
  ACCOMMODATION: ["HOTEL", "BROKER"],
  TRANSPORT: ["TRANSPORT", "BROKER"],
  FLIGHT: ["TICKETING", "BROKER"],
} as const;

export type SupplierPickerContext = keyof typeof SUPPLIER_TYPES_BY_CONTEXT;
