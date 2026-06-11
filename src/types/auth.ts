export interface JwtPayload {
  userId: string;
  email: string;
}

export interface AuthRequest {
  userId: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthRequest;
  }
}