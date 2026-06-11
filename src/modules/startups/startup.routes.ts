import { FastifyInstance } from "fastify";
import {
  createStartupHandler,
  listStartupsHandler,
  getStartupHandler,
  deleteStartupHandler,
} from "./startup.handler.js";
import { authenticate } from "../../middleware/auth.js";

export async function startupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/startups", {
    schema: {
      tags: ["Startups"],
      description: "Create a new startup",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          logo: { type: "string", format: "uri" },
          industry: { type: "string" },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            startup: { type: "object" },
          },
        },
      },
    },
  }, createStartupHandler);

  app.get("/startups", {
    schema: {
      tags: ["Startups"],
      description: "List all startups for current user",
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            startups: { type: "array" },
          },
        },
      },
    },
  }, listStartupsHandler);

  app.get("/startups/:id", {
    schema: {
      tags: ["Startups"],
      description: "Get startup by ID",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            startup: { type: "object" },
          },
        },
      },
    },
  }, getStartupHandler);

  app.delete("/startups/:id", {
    schema: {
      tags: ["Startups"],
      description: "Delete a startup",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid" },
        },
      },
      response: {
        204: { type: "null" },
      },
    },
  }, deleteStartupHandler);
}