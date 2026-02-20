import { FastifyInstance } from "fastify";

export async function eventRoutes(fastify: FastifyInstance) {
  /**
   * GET /events
   * List all events with available seats.
   */
  fastify.get(
    "/events",
    {
      schema: {
        tags: ["Events"],
        summary: "List all events",
        description: "Returns all events ordered by date, with current seat availability.",
        response: {
          200: {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    date: { type: "string", format: "date-time" },
                    venue: { type: "string" },
                    totalSeats: { type: "integer" },
                    availableSeats: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const events = await fastify.prisma.event.findMany({
        orderBy: { date: "asc" },
        select: {
          id: true,
          name: true,
          date: true,
          venue: true,
          totalSeats: true,
          availableSeats: true,
        },
      });

      return { data: events };
    }
  );

  /**
   * GET /events/:id
   * Single event detail.
   */
  fastify.get<{ Params: { id: string } }>(
    "/events/:id",
    {
      schema: {
        tags: ["Events"],
        summary: "Get event by ID",
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
            properties: {
              data: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  name: { type: "string" },
                  date: { type: "string", format: "date-time" },
                  venue: { type: "string" },
                  totalSeats: { type: "integer" },
                  availableSeats: { type: "integer" },
                },
              },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const event = await fastify.prisma.event.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          name: true,
          date: true,
          venue: true,
          totalSeats: true,
          availableSeats: true,
        },
      });

      if (!event) {
        return reply.status(404).send({
          error: "EventNotFound",
          message: `Event ${request.params.id} not found`,
        });
      }

      return { data: event };
    }
  );
}
