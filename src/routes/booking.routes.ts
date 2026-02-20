import { FastifyInstance } from "fastify";
import { CreateBookingSchema } from "../schemas/booking.schema.js";
import {
  BookingService,
  EventNotFoundError,
  InsufficientSeatsError,
  BookingNotFoundError,
  BookingAlreadyCancelledError,
} from "../services/booking.service.js";

export async function bookingRoutes(fastify: FastifyInstance) {
  const bookingService = new BookingService(fastify.prisma);

  /**
   * POST /bookings
   * Create a new booking (atomic, multi-event).
   *
   * CONSTRAINTS enforced:
   * - max 3 tickets per event per transaction (schema validation)
   * - no duplicate eventIds (schema validation)
   * - sufficient seats (transactional check with row lock)
   * - all-or-nothing: if one event fails, entire booking rolls back
   */
  fastify.post("/bookings", async (request, reply) => {
    // Validate input
    const parsed = CreateBookingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "ValidationError",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    try {
      const booking = await bookingService.createBooking(parsed.data);
      return reply.status(201).send({ data: booking });
    } catch (error) {
      if (error instanceof EventNotFoundError) {
        return reply.status(404).send({
          error: "EventNotFound",
          message: error.message,
          eventId: error.eventId,
        });
      }

      if (error instanceof InsufficientSeatsError) {
        return reply.status(409).send({
          error: "InsufficientSeats",
          message: error.message,
          eventId: error.eventId,
          requested: error.requested,
          available: error.available,
        });
      }

      // Unexpected error
      fastify.log.error(error, "Unexpected error creating booking");
      return reply.status(500).send({
        error: "InternalError",
        message: "An unexpected error occurred",
      });
    }
  });

  /**
   * GET /bookings
   * List bookings with optional filters.
   */
  fastify.get<{
    Querystring: {
      email?: string;
      status?: string;
      page?: string;
      limit?: string;
    };
  }>("/bookings", async (request, reply) => {
    const { email, status, page, limit } = request.query;

    const result = await bookingService.listBookings(
      { email, status },
      {
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      }
    );

    return result;
  });

  /**
   * GET /bookings/:id
   * Get a single booking.
   */
  fastify.get<{ Params: { id: string } }>(
    "/bookings/:id",
    async (request, reply) => {
      try {
        const booking = await bookingService.getBooking(request.params.id);
        return { data: booking };
      } catch (error) {
        if (error instanceof BookingNotFoundError) {
          return reply.status(404).send({
            error: "BookingNotFound",
            message: error.message,
          });
        }
        throw error;
      }
    }
  );

  /**
   * POST /bookings/:id/cancel
   * Cancel a booking and restore seats.
   */
  fastify.post<{ Params: { id: string } }>(
    "/bookings/:id/cancel",
    async (request, reply) => {
      try {
        const booking = await bookingService.cancelBooking(request.params.id);
        return { data: booking };
      } catch (error) {
        if (error instanceof BookingNotFoundError) {
          return reply.status(404).send({
            error: "BookingNotFound",
            message: error.message,
          });
        }
        if (error instanceof BookingAlreadyCancelledError) {
          return reply.status(409).send({
            error: "BookingAlreadyCancelled",
            message: error.message,
          });
        }
        throw error;
      }
    }
  );
}
