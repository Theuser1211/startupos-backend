import { FastifyReply } from "fastify";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, details);
    this.name = "ValidationError";
  }
}

export function handleError(reply: FastifyReply, error: unknown): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      error: error.name,
      message: error.message,
      details: error.details,
    });
    return;
  }

  reply.status(500).send({
    error: "InternalServerError",
    message:
      error instanceof Error
        ? error.message
        : String(error),
    stack:
      process.env.NODE_ENV !== "production"
        ? error instanceof Error
          ? error.stack
          : undefined
        : undefined,
  });
}