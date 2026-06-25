import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./db/client.js";
import { handleError } from "./lib/errors.js";
import { providerRegistry } from "./services/ai/provider-registry.js";

import { authRoutes } from "./modules/auth/auth.routes.js";
import { startupRoutes } from "./modules/startups/startup.routes.js";
import { blueprintRoutes } from "./modules/blueprints/blueprint.routes.js";
import { websiteRoutes } from "./modules/websites/website.routes.js";
import { deploymentRoutes } from "./modules/deployments/deployment.routes.js";
import { jobRoutes } from "./modules/jobs/jobs.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { competitorRoutes } from "./modules/competitors/competitor.routes.js";
import { briefRoutes } from "./modules/brief/brief.routes.js";

async function checkDatabase(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    logger.info("Database connection verified");
  } catch (err) {
    logger.fatal(err, "Database unreachable — exiting");
    process.exit(1);
  }
}

const app = Fastify({
  logger: true,
  bodyLimit: 1048576,
});

async function bootstrap(): Promise<void> {
  await app.register(cors, {
    origin: [
      "https://startupos-black.vercel.app",
      "http://localhost:3000",
      ...(env.PUBLIC_URL ? [env.PUBLIC_URL] : []),
    ],
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  const getSwaggerServers = () => {
    if (env.PUBLIC_URL) {
      return [{ url: env.PUBLIC_URL, description: "Production server" }];
    }
    if (env.NODE_ENV === "production") {
      return [{ url: `https://${env.HOST}:${env.PORT}`, description: "Production server (fallback)" }];
    }
    return [{ url: `http://localhost:${env.PORT}`, description: "Development server" }];
  };

  await app.register(swagger, {
    openapi: {
      info: {
        title: "StartupOS API",
        description: "Backend API for StartupOS - AI-powered startup website generation",
        version: "2.0.0",
      },
      servers: getSwaggerServers(),
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

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const requestId = request.id;
    logger.error(
      { requestId, err: error, name: error?.name, message: error?.message, stack: error?.stack, statusCode: error?.statusCode },
      "[GLOBAL-ERR] caught",
    );
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
            database: { type: "string" },
            timestamp: { type: "string" },
          },
        },
      },
    },
  }, async () => {
    let dbStatus = "ok";
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
    } catch {
      dbStatus = "error";
    }
    return { status: "ok", database: dbStatus, timestamp: new Date().toISOString() };
  });

  app.get("/admin/providers", {
    schema: {
      tags: ["Admin"],
      description: "Get AI provider health status",
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              provider: { type: "string" },
              model: { type: "string" },
              priority: { type: "number" },
              status: { type: "string" },
              requestCount: { type: "number" },
              failureCount: { type: "number" },
              cooldownRemaining: { type: "number" },
              avgLatencyMs: { type: "number" },
            },
          },
        },
      },
    },
  }, async () => {
    return providerRegistry.getHealth();
  });

  await app.register(authRoutes);
  await app.register(startupRoutes);
  await app.register(blueprintRoutes);
  await app.register(websiteRoutes);
  await app.register(deploymentRoutes);
  await app.register(jobRoutes);
  await app.register(dashboardRoutes);
  await app.register(competitorRoutes);
  await app.register(briefRoutes);

  await checkDatabase();

  logger.info(app.printRoutes());

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
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down...");
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
});

export { app, bootstrap };
