import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { GenerateWebsiteInput } from "./website.schema.js";
import { NotFoundError, ForbiddenError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { getQueue } from "../../queue/setup.js";

export async function generateWebsiteHandler(
  request: FastifyRequest<{ Body: GenerateWebsiteInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { startupId } = request.body;
  const userId = request.user!.userId;

  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    select: { userId: true, name: true },
  });

  if (!startup) {
    throw new NotFoundError("Startup");
  }

  if (startup.userId !== userId) {
    throw new ForbiddenError("You do not own this startup");
  }

  const blueprint = await prisma.blueprint.findUnique({
    where: { startupId },
  });

  if (!blueprint) {
    throw new NotFoundError("Blueprint. Generate a blueprint first.");
  }

  const existingJob = await prisma.job.findFirst({
    where: {
      startupId,
      type: "WEBSITE_GENERATION",
      status: { in: ["PENDING", "PROCESSING"] },
    },
  });

  if (existingJob) {
    reply.status(202).send({
      jobId: existingJob.id,
      status: existingJob.status,
      message: "Website generation already in progress",
    });
    return;
  }

  const job = await prisma.job.create({
    data: {
      type: "WEBSITE_GENERATION",
      status: "PENDING",
      payload: { startupId, blueprintId: blueprint.id },
      startupId,
    },
  });

  const queue = getQueue();
  await queue.add("website-generation", {
    jobId: job.id,
    startupId,
    userId,
    type: "WEBSITE_GENERATION",
    payload: { blueprintId: blueprint.id, startupName: startup.name },
  });

  logger.info({ jobId: job.id, startupId }, "Website generation job queued");

  reply.status(202).send({
    jobId: job.id,
    status: "PENDING",
  });
}

export async function getWebsiteHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const userId = request.user!.userId;

  const website = await prisma.website.findUnique({
    where: { id },
    include: {
      spec: true,
      deployment: true,
      startup: { select: { userId: true, name: true } },
    },
  });

  if (!website) {
    throw new NotFoundError("Website");
  }

  if (website.startup.userId !== userId) {
    throw new ForbiddenError("You do not own this website");
  }

  reply.send({ website });
}