import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import { getBriefHandler } from "./brief.handler.js";

export async function briefRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/brief/:startupId", {
    schema: {
      tags: ["Brief"],
      description: "Generate a daily brief for a startup with market news, opportunities, and risks",
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
            summary: { type: "string" },
            marketNews: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  source: { type: "string" },
                  url: { type: "string" },
                  relevance: { type: "string" },
                },
              },
            },
            opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  description: { type: "string" },
                  impact: { type: "string" },
                  effort: { type: "string" },
                },
              },
            },
            risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  description: { type: "string" },
                  severity: { type: "string" },
                  mitigation: { type: "string" },
                },
              },
            },
            generatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  }, getBriefHandler);
}
