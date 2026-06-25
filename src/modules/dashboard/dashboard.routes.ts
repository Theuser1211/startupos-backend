import { FastifyInstance } from "fastify";
import { getDashboardHandler } from "./dashboard.handler.js";
import { authenticate } from "../../middleware/auth.js";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/dashboard/:startupId", {
    schema: {
      tags: ["Dashboard"],
      description: "Get startup dashboard with health score, recent events, and recommended actions",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["startupId"],
        properties: { startupId: { type: "string", format: "uuid" } },
      },
      response: {
        200: {
          type: "object",
          properties: {
            startup: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                industry: { type: ["string", "null"] },
              },
            },
            healthScore: { type: "integer" },
            history: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  score: { type: "integer" },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
            recentEvents: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  type: { type: "string" },
                  metadata: { type: "object" },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
            topActions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  action: { type: "string" },
                  description: { type: "string" },
                  priority: { type: "string" },
                  link: { type: ["string", "null"] },
                  completed: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
  }, getDashboardHandler);
}
