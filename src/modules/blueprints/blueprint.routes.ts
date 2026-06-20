import { FastifyInstance } from "fastify";
import { generateBlueprintHandler, getBlueprintHandler } from "./blueprint.handler.js";
import { authenticate } from "../../middleware/auth.js";

export async function blueprintRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/blueprints/generate", {
    schema: {
      tags: ["Blueprints"],
      description: "Generate a blueprint for a startup",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["startupId"],
        properties: {
          startupId: { type: "string", format: "uuid" },
          prompt: { type: "string", minLength: 10 },
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
  }, generateBlueprintHandler);

  app.get("/blueprints/:id", {
    schema: {
      tags: ["Blueprints"],
      description: "Get blueprint by ID",
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
            blueprint: { type: "object" },
          },
        },
      },
    },
  }, getBlueprintHandler);
}