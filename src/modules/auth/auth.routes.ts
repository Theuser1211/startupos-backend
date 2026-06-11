import { FastifyInstance } from "fastify";
import { registerHandler, loginHandler, meHandler } from "./auth.handler.js";
import { authenticate } from "../../middleware/auth.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", {
    schema: {
      tags: ["Auth"],
      description: "Register a new user",
      body: {
        type: "object",
        required: ["email", "password", "name"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          name: { type: "string" },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            user: {
              type: "object",
              properties: {
                id: { type: "string" },
                email: { type: "string" },
                name: { type: "string" },
                createdAt: { type: "string" },
              },
            },
            token: { type: "string" },
          },
        },
      },
    },
  }, registerHandler);

  app.post("/auth/login", {
    schema: {
      tags: ["Auth"],
      description: "Login with email and password",
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            user: {
              type: "object",
              properties: {
                id: { type: "string" },
                email: { type: "string" },
                name: { type: "string" },
                createdAt: { type: "string" },
              },
            },
            token: { type: "string" },
          },
        },
      },
    },
  }, loginHandler);

  app.get("/auth/me", {
    preHandler: [authenticate],
    schema: {
      tags: ["Auth"],
      description: "Get current user profile",
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            user: {
              type: "object",
              properties: {
                id: { type: "string" },
                email: { type: "string" },
                name: { type: "string" },
                createdAt: { type: "string" },
                updatedAt: { type: "string" },
              },
            },
          },
        },
      },
    },
  }, meHandler);
}