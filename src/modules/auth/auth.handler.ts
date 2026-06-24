import { FastifyRequest, FastifyReply } from "fastify";
import { hash, compare } from "bcrypt";
import { prisma } from "../../db/client.js";
import { signToken, verifyToken } from "../../lib/jwt.js";
import { RegisterInput, LoginInput } from "./auth.schema.js";
import { AppError, UnauthorizedError } from "../../lib/errors.js";

const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

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
  const ip = request.ip;

  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (record) {
    if (now - record.firstAttempt > LOGIN_WINDOW_MS) {
      loginAttempts.delete(ip);
    } else if (record.count >= MAX_LOGIN_ATTEMPTS) {
      throw new AppError(429, "Too many login attempts. Try again later.");
    }
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const r = loginAttempts.get(ip) ?? { count: 0, firstAttempt: now };
    r.count++;
    r.firstAttempt ??= now;
    loginAttempts.set(ip, r);
    throw new AppError(401, "Invalid email or password");
  }

  const valid = await compare(password, user.password);
  if (!valid) {
    const r = loginAttempts.get(ip) ?? { count: 0, firstAttempt: now };
    r.count++;
    r.firstAttempt ??= now;
    loginAttempts.set(ip, r);
    throw new AppError(401, "Invalid email or password");
  }

  loginAttempts.delete(ip);

  const token = signToken({ userId: user.id, email: user.email });

  reply.send({
    user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
    token,
  });
}

export async function refreshTokenHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or invalid authorization header");
  }

  const token = authHeader.slice(7);
  let payload: { userId: string; email: string };
  try {
    payload = verifyToken(token, true) as { userId: string; email: string };
  } catch {
    throw new UnauthorizedError("Invalid token");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true },
  });

  if (!user) {
    throw new UnauthorizedError("User no longer exists");
  }

  const newToken = signToken({ userId: user.id, email: user.email });
  reply.send({ token: newToken });
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