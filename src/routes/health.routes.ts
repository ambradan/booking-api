import { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async () => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        database: "connected",
      };
    } catch {
      return {
        status: "degraded",
        timestamp: new Date().toISOString(),
        database: "disconnected",
      };
    }
  });
}
