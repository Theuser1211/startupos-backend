import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { NotFoundError, ForbiddenError } from "../../lib/errors.js";
import { computeHealthScore, generateActions, persistActions, captureEvent } from "./dashboard.service.js";

export async function getDashboardHandler(
  request: FastifyRequest<{ Params: { startupId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { startupId } = request.params;
  const userId = request.user!.userId;

  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    select: { id: true, name: true, industry: true, userId: true },
  });

  if (!startup) throw new NotFoundError("Startup");
  if (startup.userId !== userId) throw new ForbiddenError("You do not own this startup");

  const health = await computeHealthScore(startupId);

  const history = await prisma.healthScoreSnapshot.findMany({
    where: { startupId },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: { score: true, createdAt: true },
  });

  const rawEvents = await prisma.startupEvent.findMany({
    where: { startupId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const actions = await generateActions(startupId);

  await captureEvent(startupId, "DASHBOARD_VIEWED", { score: health.score });

  const snapshot = await prisma.healthScoreSnapshot.findFirst({
    where: { startupId },
    orderBy: { createdAt: "desc" },
  });

  if (!snapshot || snapshot.score !== health.score) {
    await prisma.healthScoreSnapshot.create({
      data: { startupId, score: health.score },
    });
  }

  await persistActions(startupId, actions);

  const existingActions = await prisma.founderAction.findMany({
    where: { startupId, completed: false },
    orderBy: [
      { priority: "asc" },
      { createdAt: "desc" },
    ],
    take: 5,
  });

  reply.send({
    startup: { id: startup.id, name: startup.name, industry: startup.industry },
    healthScore: health.score,
    healthBreakdown: health.breakdown,
    history,
    recentEvents: rawEvents.map((e) => ({
      id: e.id,
      type: e.type,
      metadata: e.metadata,
      createdAt: e.createdAt,
    })),
    topActions: existingActions.map((a) => ({
      id: a.id,
      action: a.action,
      description: a.description,
      priority: a.priority,
      link: a.link,
      completed: a.completed,
    })),
  });
}
