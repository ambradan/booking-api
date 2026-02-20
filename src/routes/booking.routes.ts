import { FastifyInstance } from "fastify";
import { CreateBookingSchema } from "../schemas/booking.schema.js";
import {
  BookingService,
  EventNotFoundError,
  InsufficientSeatsError,
  BookingNotFoundError,
  BookingAlreadyCancelledError,
} from "../services/booking.service.js";

const BookingResponse = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    customerEmail: { type: "string", format: "email" },
    status: { type: "string", enum: ["CONFIRMED", "CANCELLED"] },
    createdAt: { type: "string", format: "date-time" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          eventId: { type: "string", format: "uuid" },
          eventName: { type: "string" },
          quantity: { type: "integer" },
        },
      },
    },
    totalTickets: { type: "integer" },
  },
};

const ErrorResponse = {
  type: "object",
  properties: {
    error: { type: "string" },
    message: { type: "string" },
  },
};

export async function bookingRoutes(fastify: FastifyInstance) {
  const bookingService = new BookingService(fastify.prisma);

  /**
   * POST /bookings
   * Create a new booking (atomic, multi-event).
   *
   * Supports optional Idempotency-Key header to prevent duplicate
   * bookings on client retry (network timeout, etc.).
   */
  fastify.post(
    "/bookings",
    {
      schema: {
        tags: ["Bookings"],
        summary: "Create a booking",
        description:
          "Creates an atomic booking for one or more events. Uses SELECT ... FOR UPDATE to prevent overselling. If any event fails validation, the entire booking rolls back. Supports optional `Idempotency-Key` header for safe retries.",
        headers: {
          type: "object",
          properties: {
            "idempotency-key": {
              type: "string",
              description:
                "Optional. If provided, duplicate requests with the same key return the original booking instead of creating a new one.",
            },
          },
        },
        body: {
          type: "object",
          required: ["customerEmail", "items"],
          properties: {
            customerName: { type: "string" },
            customerEmail: { type: "string", format: "email" },
            items: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["eventId", "quantity"],
                properties: {
                  eventId: { type: "string", format: "uuid" },
                  quantity: {
                    type: "integer",
                    minimum: 1,
                    maximum: 3,
                    description: "Max 3 tickets per event per booking",
                  },
                },
              },
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: { data: BookingResponse },
          },
          400: ErrorResponse,
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
              eventId: { type: "string" },
            },
          },
          409: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
              eventId: { type: "string" },
              requested: { type: "integer" },
              available: { type: "integer" },
            },
          },
          500: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
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

      // Extract idempotency key from header (case-insensitive)
      const idempotencyKey =
        (request.headers["idempotency-key"] as string) || undefined;

      try {
        const booking = await bookingService.createBooking(
          parsed.data,
          idempotencyKey
        );
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

        fastify.log.error(error, "Unexpected error creating booking");
        return reply.status(500).send({
          error: "InternalError",
          message: "An unexpected error occurred",
        });
      }
    }
  );

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
  }>(
    "/bookings",
    {
      schema: {
        tags: ["Bookings"],
        summary: "List bookings",
        description:
          "List all bookings with optional email/status filters and pagination.",
        querystring: {
          type: "object",
          properties: {
            email: {
              type: "string",
              format: "email",
              description: "Filter by customer email",
            },
            status: {
              type: "string",
              enum: ["CONFIRMED", "CANCELLED"],
              description: "Filter by status",
            },
            page: { type: "string", description: "Page number (default: 1)" },
            limit: {
              type: "string",
              description: "Items per page (default: 20)",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              data: { type: "array", items: BookingResponse },
              pagination: {
                type: "object",
                properties: {
                  page: { type: "integer" },
                  limit: { type: "integer" },
                  total: { type: "integer" },
                  totalPages: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, status, page, limit } = request.query;

      const result = await bookingService.listBookings(
        { email, status },
        {
          page: page ? parseInt(page, 10) : undefined,
          limit: limit ? parseInt(limit, 10) : undefined,
        }
      );

      return result;
    }
  );

  /**
   * GET /bookings/:id
   * Get a single booking.
   */
  fastify.get<{ Params: { id: string } }>(
    "/bookings/:id",
    {
      schema: {
        tags: ["Bookings"],
        summary: "Get booking by ID",
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
          },
          required: ["id"],
        },
        response: {
          200: {
            type: "object",
            properties: { data: BookingResponse },
          },
          404: ErrorResponse,
        },
      },
    },
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
    {
      schema: {
        tags: ["Bookings"],
        summary: "Cancel a booking",
        description:
          "Cancels a booking and atomically restores seats. Uses the same FOR UPDATE locking pattern.",
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
          },
          required: ["id"],
        },
        response: {
          200: {
            type: "object",
            properties: { data: BookingResponse },
          },
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
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
