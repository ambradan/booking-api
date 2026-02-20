import { z } from "zod";

/**
 * Single booking item: one event + quantity.
 * CONSTRAINT (from brief): max 3 tickets per event per transaction.
 * CONSTRAINT (implicit): quantity must be positive integer.
 */
const BookingItemSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID"),
  quantity: z
    .number()
    .int("quantity must be an integer")
    .min(1, "quantity must be at least 1")
    .max(3, "maximum 3 tickets per event per transaction"),
});

/**
 * Booking request: multiple events in a single transaction.
 * CONSTRAINT: no duplicate eventIds in the same request.
 */
export const CreateBookingSchema = z
  .object({
    customerEmail: z.string().email("must be a valid email"),
    items: z
      .array(BookingItemSchema)
      .min(1, "at least one booking item is required")
      .max(20, "maximum 20 events per transaction"),
  })
  .refine(
    (data) => {
      const eventIds = data.items.map((item) => item.eventId);
      return new Set(eventIds).size === eventIds.length;
    },
    {
      message: "duplicate eventId in the same transaction is not allowed",
      path: ["items"],
    }
  );

export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;
export type BookingItemInput = z.infer<typeof BookingItemSchema>;
