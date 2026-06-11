import { FastifyRequest, FastifyReply } from "fastify";
import { hash, compare } from "bcrypt";
import { prisma } from "../../db/client.js";
import { signToken } from "../../lib/jwt.js";
import { RegisterInput, LoginInput } from "./auth.schema.js";
import { AppError } from "../../lib/errors.js";

export async function registerHandler(
  request: FastifyRequest<{ Body: RegisterInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { email, password, name } = request.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(409, "Email already registered");
  }

  const hashedPassword = await hash(password, 12);

  const user = await prisma.user.create({
    data: { email, password: hashedPassword, name },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  const token = signToken({ userId: user.id, email: user.email });

  reply.status(201).send({ user, token });
}

export async function loginHandler(
  request: FastifyRequest<{ Body: LoginInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { email, password } = request.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError(401, "Invalid email or password");
  }

  const valid = await compare(password, user.password);
  if (!valid) {
    throw new AppError(401, "Invalid email or password");
  }

  const token = signToken({ userId: user.id, email: user.email });

  reply.send({
    user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
    token,
  });
}

export async function meHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: request.user!.userId },
    select: { id: true, email: true, name: true, createdAt: true, updatedAt: true },
  });

  if (!user) {
    throw new AppError(404, "User not found");
  }

  reply.send({ user });
}