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
            id: { type: "string" },
            summary: { type: "string" },
            wins: { type: "array", items: { type: "string" } },
            priorities: { type: "array", items: { type: "string" } },
            competitorUpdates: { type: "array", items: { type: "string" } },
            healthScore: { type: "number" },
            healthHistory: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  score: { type: "number" },
                  createdAt: { type: "string" },
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
