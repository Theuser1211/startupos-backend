import { FastifyInstance } from "fastify";
import { generateWebsiteHandler, getWebsiteHandler } from "./website.handler.js";
import { authenticate } from "../../middleware/auth.js";

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
        202: {
          type: "object",
          properties: {
            jobId: { type: "string" },
            status: { type: "string" },
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
            website: { type: "object" },
          },
        },
      },
    },
  }, getWebsiteHandler);
}