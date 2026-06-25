import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import {
  addCompetitorHandler,
  listCompetitorsHandler,
  getCompetitorHistoryHandler,
} from "./competitor.handler.js";

export async function competitorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/competitors", {
    schema: {
      tags: ["Competitors"],
      description: "Add a competitor for a startup",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["startupId", "name", "website"],
        properties: {
          startupId: { type: "string" },
          name: { type: "string", minLength: 1 },
          website: { type: "string" },
          description: { type: "string" },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            competitor: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                website: { type: "string" },
                description: { type: ["string", "null"] },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    },
  }, addCompetitorHandler);

  app.get("/competitors/:startupId", {
    schema: {
      tags: ["Competitors"],
      description: "List competitors for a startup",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["startupId"],
        properties: { startupId: { type: "string" } },
      },
      response: {
        200: {
          type: "object",
          properties: {
            competitors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  website: { type: "string" },
                  description: { type: ["string", "null"] },
                  createdAt: { type: "string" },
                  updatedAt: { type: "string" },
                  latestSnapshot: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      title: { type: "string" },
                      summary: { type: ["string", "null"] },
                      pricing: { type: ["string", "null"] },
                      features: { type: "object" },
                      rawContent: { type: ["string", "null"] },
                      capturedAt: { type: "string" },
                    },
                    nullable: true,
                  },
                  changes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        type: { type: "string" },
                        oldValue: { type: ["string", "null"] },
                        newValue: { type: ["string", "null"] },
                        detectedAt: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, listCompetitorsHandler);

  app.get("/competitors/:id/history", {
    schema: {
      tags: ["Competitors"],
      description: "Get snapshot history and changes for a competitor",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
  }, getCompetitorHistoryHandler);
}
