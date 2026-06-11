import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./db/client.js";
import { closeQueue } from "./queue/setup.js";
import { startWorker } from "./queue/worker.js";
import { startJobMonitor, stopJobMonitor } from "./queue/monitor.js";
import { handleError } from "./lib/errors.js";

import { authRoutes } from "./modules/auth/auth.routes.js";
import { startupRoutes } from "./modules/startups/startup.routes.js";
import { blueprintRoutes } from "./modules/blueprints/blueprint.routes.js";
import { websiteRoutes } from "./modules/websites/website.routes.js";
import { deploymentRoutes } from "./modules/deployments/deployment.routes.js";
import { jobRoutes } from "./modules/jobs/jobs.routes.js";

const app = Fastify({
  logger: true,
});

async function bootstrap(): Promise<void> {
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "StartupOS API",
        description: "Backend API for StartupOS - AI-powered startup website generation",
        version: "2.0.0",
      },
      servers: [
        { url: `http://localhost:${env.PORT}`, description: "Development server" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });

  app.addHook("onRequest", async (request) => {
    request.log.info({ method: request.method, url: request.url }, "Incoming request");
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error.statusCode === 429) {
      reply.status(429).send({
        error: "TooManyRequests",
        message: "Rate limit exceeded. Try again later.",
      });
      return;
    }

    handleError(reply, error);
  });

  app.get("/health", {
    schema: {
      tags: ["Health"],
      description: "Health check endpoint",
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            timestamp: { type: "string" },
          },
        },
      },
    },
  }, async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  await app.register(authRoutes);
  await app.register(startupRoutes);
  await app.register(blueprintRoutes);
  await app.register(websiteRoutes);
  await app.register(deploymentRoutes);
  await app.register(jobRoutes);

  startWorker();
  startJobMonitor();

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`Server running on http://${env.HOST}:${env.PORT}`);
  logger.info(`Swagger docs at http://${env.HOST}:${env.PORT}/docs`);
}

bootstrap().catch((err) => {
  logger.fatal(err, "Failed to start server");
  process.exit(1);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down...");
  await app.close();
  await prisma.$disconnect();
  await closeQueue();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down...");
  await app.close();
  await prisma.$disconnect();
  await closeQueue();
  process.exit(0);
});

export { app, bootstrap };