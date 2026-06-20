import { FastifyInstance } from "fastify";
import { getJobHandler } from "./jobs.handler.js";
import { authenticate } from "../../middleware/auth.js";

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/jobs/:id", {
    schema: {
      tags: ["Jobs"],
      description: "Get job status and result by ID",
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
            job: {
              type: "object",
              properties: {
                id: { type: "string" },
                type: { type: "string" },
                status: { type: "string" },
                result: {
                  type: "object",
                  properties: {},
                  additionalProperties: true,
                },
                error: { type: "string" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
      },
    },
  }, getJobHandler);
}