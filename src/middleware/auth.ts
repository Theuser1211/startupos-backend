import { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken } from "../lib/jwt.js";
import { UnauthorizedError } from "../lib/errors.js";

export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or invalid authorization header");
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    request.user = {
      userId: payload.userId,
      email: payload.email,
    };
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
}