import type { JwtPayload } from "@startupos/shared";

export type { JwtPayload };

declare module "fastify" {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}