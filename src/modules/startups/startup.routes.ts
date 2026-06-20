import { FastifyInstance } from "fastify";
import {
  createStartupHandler,
  listStartupsHandler,
  getStartupHandler,
  deleteStartupHandler,
} from "./startup.handler.js";
import { authenticate } from "../../middleware/auth.js";

const startupResponse = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    logo: { type: ["string", "null"] },
    industry: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    blueprint: {
      type: ["object", "null"],
      properties: {
        id: { type: "string" },
        content: {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
    websites: {
      type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              content: {
                type: "object",
                properties: {},
                additionalProperties: true,
              },
              status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          deployment: {
            type: ["object", "null"],
            properties: {
              id: { type: "string" },
              status: { type: "string" },
              url: { type: ["string", "null"] },
              provider: { type: ["string", "null"] },
              error: { type: ["string", "null"] },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
  },
};

const startupListResponse = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    logo: { type: ["string", "null"] },
    industry: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    _count: {
      type: "object",
      properties: {
        websites: { type: "integer" },
        jobs: { type: "integer" },
      },
    },
  },
};

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
            startup: startupResponse,
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
            startups: {
              type: "array",
              items: startupListResponse,
            },
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
            startup: startupResponse,
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