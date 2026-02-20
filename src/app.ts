import Fastify, { FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
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

  // Request ID propagation — expose Fastify's internal request ID
  // so clients can correlate responses with server logs.
  app.addHook("onSend", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
  });

  // Rate limiting — prevent abuse on write endpoints
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
  });

  // OpenAPI documentation
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Booking API",
        description:
          "Event booking system with atomic transactions and pessimistic locking (SELECT ... FOR UPDATE).",
        version: "1.0.0",
      },
      tags: [
        {
          name: "Events",
          description: "Browse available events",
        },
        {
          name: "Bookings",
          description:
            "Create, list, view, and cancel bookings. All booking operations are atomic with row-level locking.",
        },
        {
          name: "Health",
          description: "Service health check",
        },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });

  // Plugins
  await app.register(prismaPlugin);

  // Routes
  await app.register(healthRoutes);
  await app.register(eventRoutes, { prefix: "/api/v1" });
  await app.register(bookingRoutes, { prefix: "/api/v1" });

  return app;
}
