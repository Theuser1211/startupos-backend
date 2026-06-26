import { FastifyInstance } from "fastify";
import { generateWebsiteHandler, getWebsiteByStartupHandler, getWebsiteHandler } from "./website.handler.js";
import { authenticate } from "../../middleware/auth.js";

const websiteResponse = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    content: { type: "object", additionalProperties: true },
    status: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    startupId: { type: "string" },
    spec: { type: ["object", "null"] },
    deployment: { type: ["object", "null"] },
  },
};

export async function websiteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/websites/generate", {
    schema: {
      tags: ["Websites"],
      description: "Generate a website from a startup blueprint",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["startupId"],
        properties: {
          startupId: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            website: websiteResponse,
          },
        },
      },
    },
  }, generateWebsiteHandler);

  app.get("/websites/:id", {
    schema: {
      tags: ["Websites"],
      description: "Get website by ID",
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
            website: websiteResponse,
          },
        },
      },
    },
  }, getWebsiteHandler);

  app.get("/websites/by-startup/:startupId", {
    schema: {
      tags: ["Websites"],
      description: "Get website by startup ID",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["startupId"],
        properties: {
          startupId: { type: "string", format: "uuid" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            website: {
              type: ["object", "null"],
              nullable: true,
            },
          },
        },
      },
    },
  }, getWebsiteByStartupHandler);
}