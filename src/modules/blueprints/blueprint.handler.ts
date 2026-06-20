import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { GenerateBlueprintInput } from "./blueprint.schema.js";
import { NotFoundError, ForbiddenError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { getQueue } from "../../queue/setup.js";

export async function generateBlueprintHandler(
  request: FastifyRequest<{ Body: GenerateBlueprintInput }>,
  reply: FastifyReply,
): Promise<void> {
  const requestId = request.id;
  const { startupId, prompt } = request.body;
  const userId = request.user!.userId;

  logger.info({ requestId, startupId, userId }, "START generateBlueprintHandler");

  try {
    logger.info({ requestId }, "STEP: startup lookup");
    const startup = await prisma.startup.findUnique({
      where: { id: startupId },
      select: { userId: true },
    });
    logger.info({ requestId, found: !!startup }, "STEP: startup lookup done");

    if (!startup) {
      logger.warn({ requestId, startupId }, "STEP: startup not found");
      throw new NotFoundError("Startup");
    }

    logger.info({ requestId, ownerMatch: startup.userId === userId }, "STEP: ownership check");
    if (startup.userId !== userId) {
      logger.warn({ requestId, startupId, userId }, "STEP: forbidden");
      throw new ForbiddenError("You do not own this startup");
    }

    logger.info({ requestId }, "STEP: existing blueprint check");
    const existingBlueprint = await prisma.blueprint.findUnique({
      where: { startupId },
    });
    logger.info({ requestId, exists: !!existingBlueprint }, "STEP: existing blueprint check done");

    if (existingBlueprint) {
      logger.info({ requestId }, "STEP: returning existing blueprint");
      reply.send({
        jobId: null,
        blueprint: existingBlueprint,
        message: "Blueprint already exists for this startup",
      });
      return;
    }

    logger.info({ requestId }, "STEP: existing job check");
    const existingJob = await prisma.job.findFirst({
      where: {
        startupId,
        type: "BLUEPRINT_GENERATION",
        status: { in: ["PENDING", "PROCESSING"] },
      },
    });
    logger.info({ requestId, exists: !!existingJob }, "STEP: existing job check done");

    if (existingJob) {
      logger.info({ requestId, existingJobId: existingJob.id }, "STEP: returning existing job");
      reply.status(202).send({
        jobId: existingJob.id,
        status: existingJob.status,
        message: "Blueprint generation already in progress",
      });
      return;
    }

    logger.info({ requestId }, "STEP: creating job record");
    const job = await prisma.job.create({
      data: {
        type: "BLUEPRINT_GENERATION",
        status: "PENDING",
        payload: { startupId, prompt },
        startupId,
      },
    });
    logger.info({ requestId, jobId: job.id }, "STEP: job record created");

    logger.info({ requestId }, "STEP: getting queue");
    const queue = getQueue();
    logger.info({ requestId }, "STEP: adding to queue");
    try {
      await queue.add("blueprint-generation", {
        jobId: job.id,
        startupId,
        userId,
        type: "BLUEPRINT_GENERATION",
        payload: { prompt },
      });
    } catch (queueError) {
      logger.error({ requestId, err: queueError, jobId: job.id }, "STEP: queue.add failed");
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: `Queue add failed: ${queueError instanceof Error ? queueError.message : "Unknown"}`,
        },
      });
      throw queueError;
    }
    logger.info({ requestId, jobId: job.id }, "STEP: queue.add succeeded");

    logger.info({ requestId, jobId: job.id }, "STEP: sending response");
    reply.status(202).send({
      jobId: job.id,
      status: "PENDING",
    });
    logger.info({ requestId }, "STEP: response sent");
  } catch (error) {
    logger.error(
      { requestId, err: error, startupId, userId, prompt: prompt?.substring(0, 100) },
      "Blueprint generation handler failed",
    );
    throw error;
  }
}

export async function getBlueprintHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const userId = request.user!.userId;

  const blueprint = await prisma.blueprint.findUnique({
    where: { id },
    include: {
      startup: { select: { userId: true, name: true } },
    },
  });

  if (!blueprint) {
    throw new NotFoundError("Blueprint");
  }

  if (blueprint.startup.userId !== userId) {
    throw new ForbiddenError("You do not own this blueprint");
  }

  reply.send({ blueprint });
}