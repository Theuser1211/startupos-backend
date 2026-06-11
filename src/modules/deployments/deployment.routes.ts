import { FastifyInstance } from "fastify";
import { createDeploymentHandler, getDeploymentHandler } from "./deployment.handler.js";
import { authenticate } from "../../middleware/auth.js";

export async function deploymentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/deployments/create", {
    schema: {
      tags: ["Deployments"],
      description: "Create a deployment for a website",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["websiteId"],
        properties: {
          websiteId: { type: "string", format: "uuid" },
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
  }, createDeploymentHandler);

  app.get("/deployments/:id", {
    schema: {
      tags: ["Deployments"],
      description: "Get deployment by ID",
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
            deployment: { type: "object" },
          },
        },
      },
    },
  }, getDeploymentHandler);
}