import { FastifyInstance } from "fastify";

export async function eventRoutes(fastify: FastifyInstance) {
  /**
   * GET /events
   * List all events with available seats.
   */
  fastify.get("/events", async (request, reply) => {
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
  });

  /**
   * GET /events/:id
   * Single event detail.
   */
  fastify.get<{ Params: { id: string } }>(
    "/events/:id",
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
