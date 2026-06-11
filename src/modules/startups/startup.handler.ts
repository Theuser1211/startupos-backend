import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { CreateStartupInput } from "./startup.schema.js";
import { NotFoundError, ForbiddenError } from "../../lib/errors.js";

export async function createStartupHandler(
  request: FastifyRequest<{ Body: CreateStartupInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { name, description, logo, industry } = request.body;
  const userId = request.user!.userId;

  const startup = await prisma.startup.create({
    data: {
      name,
      description: description ?? null,
      logo: logo ?? null,
      industry: industry ?? null,
      userId,
    },
  });

  reply.status(201).send({ startup });
}

export async function listStartupsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.userId;

  const startups = await prisma.startup.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { websites: true } },
    },
  });

  reply.send({ startups });
}

export async function getStartupHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const userId = request.user!.userId;

  const startup = await prisma.startup.findUnique({
    where: { id },
    include: {
      blueprint: true,
      websites: {
        include: {
          deployment: true,
        },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { websites: true, jobs: true } },
    },
  });

  if (!startup) {
    throw new NotFoundError("Startup");
  }

  if (startup.userId !== userId) {
    throw new ForbiddenError("You do not own this startup");
  }

  reply.send({ startup });
}

export async function deleteStartupHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const userId = request.user!.userId;

  const startup = await prisma.startup.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!startup) {
    throw new NotFoundError("Startup");
  }

  if (startup.userId !== userId) {
    throw new ForbiddenError("You do not own this startup");
  }

  await prisma.startup.delete({ where: { id } });

  reply.status(204).send();
}