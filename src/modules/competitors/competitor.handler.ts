import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { NotFoundError, ForbiddenError } from "../../lib/errors.js";
import {
  addCompetitor,
  getCompetitorsForStartup,
  getCompetitorHistory,
} from "./competitor.service.js";

export async function addCompetitorHandler(
  request: FastifyRequest<{ Body: { startupId: string; name: string; website: string; description?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { startupId, name, website, description } = request.body;
  const userId = request.user!.userId;

  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    select: { userId: true },
  });

  if (!startup) throw new NotFoundError("Startup");
  if (startup.userId !== userId) throw new ForbiddenError("You do not own this startup");

  const competitor = await addCompetitor(startupId, { name, website, description });

  reply.status(201).send({ competitor });
}

export async function listCompetitorsHandler(
  request: FastifyRequest<{ Params: { startupId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { startupId } = request.params;
  const userId = request.user!.userId;

  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    select: { userId: true },
  });

  if (!startup) throw new NotFoundError("Startup");
  if (startup.userId !== userId) throw new ForbiddenError("You do not own this startup");

  const competitors = await getCompetitorsForStartup(startupId);

  reply.send({ competitors });
}

export async function getCompetitorHistoryHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const userId = request.user!.userId;

  const competitor = await prisma.competitor.findUnique({
    where: { id },
    include: { startup: { select: { userId: true } } },
  });

  if (!competitor) throw new NotFoundError("Competitor");
  if (competitor.startup.userId !== userId) throw new ForbiddenError("You do not own this competitor");

  const history = await getCompetitorHistory(id);

  reply.send(history);
}
