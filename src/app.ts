import Fastify, { FastifyInstance } from "fastify";
import prismaPlugin from "./plugins/prisma.js";
import { eventRoutes } from "./routes/event.routes.js";
import { bookingRoutes } from "./routes/booking.routes.js";
import { healthRoutes } from "./routes/health.routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "development" ? "info" : "warn",
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty" }
          : undefined,
    },
  });

  // Plugins
  await app.register(prismaPlugin);

  // Routes
  await app.register(healthRoutes);
  await app.register(eventRoutes, { prefix: "/api/v1" });
  await app.register(bookingRoutes, { prefix: "/api/v1" });

  return app;
}
