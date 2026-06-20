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

  try {
    logger.info({ requestId }, "[BP2] startup lookup start");
    const startup = await prisma.startup.findUnique({
      where: { id: startupId },
      select: { userId: true, description: true },
    });
    logger.info({ requestId, found: !!startup }, "[BP2] startup lookup done");

    if (!startup) {
      logger.warn({ requestId, startupId }, "[BP2] startup not found");
      throw new NotFoundError("Startup");
    }

    const effectivePrompt = prompt ?? startup.description ?? "";
    if (!effectivePrompt || effectivePrompt.length < 10) {
      logger.warn({ requestId, startupId }, "[BP3] prompt missing or too short");
      throw new Error("Prompt is required (provide in request or set startup description)");
    }

    logger.info({ requestId, startupId, userId, prompt: effectivePrompt?.substring(0, 50) }, "[BP1] request received");
    logger.info({ requestId, ownerMatch: startup.userId === userId }, "[BP3] ownership check");
    if (startup.userId !== userId) {
      logger.warn({ requestId, startupId, userId }, "[BP3] forbidden");
      throw new ForbiddenError("You do not own this startup");
    }

    logger.info({ requestId }, "[BP4] existing blueprint check");
    const existingBlueprint = await prisma.blueprint.findUnique({
      where: { startupId },
    });
    logger.info({ requestId, exists: !!existingBlueprint }, "[BP4] existing blueprint check done");

    if (existingBlueprint) {
      logger.info({ requestId }, "[BP4] returning existing blueprint");
      reply.send({
        jobId: null,
        blueprint: existingBlueprint,
        message: "Blueprint already exists for this startup",
      });
      return;
    }

    logger.info({ requestId }, "[BP5] existing job check");
    const existingJob = await prisma.job.findFirst({
      where: {
        startupId,
        type: "BLUEPRINT_GENERATION",
        status: { in: ["PENDING", "PROCESSING"] },
      },
    });
    logger.info({ requestId, exists: !!existingJob }, "[BP5] existing job check done");

    if (existingJob) {
      logger.info({ requestId, existingJobId: existingJob.id }, "[BP5] returning existing job");
      reply.status(202).send({
        jobId: existingJob.id,
        status: existingJob.status,
        message: "Blueprint generation already in progress",
      });
      return;
    }

    logger.info({ requestId }, "[BP6] creating job record");
    const job = await prisma.job.create({
      data: {
        type: "BLUEPRINT_GENERATION",
        status: "PENDING",
        payload: { startupId, prompt: effectivePrompt },
        startupId,
      },
    });
    logger.info({ requestId, jobId: job.id }, "[BP6] job record created");

    logger.info({ requestId }, "[BP7] getting queue");
    const queue = getQueue();
    logger.info({ requestId, jobId: job.id }, "[BP8] queue.add start");
    try {
      await queue.add("blueprint-generation", {
        jobId: job.id,
        startupId,
        userId,
        type: "BLUEPRINT_GENERATION",
        payload: { prompt: effectivePrompt },
      });
    } catch (queueError: unknown) {
      const qe = queueError as Error;
      logger.error({ requestId, err: queueError, jobId: job.id, name: qe?.name, message: qe?.message, stack: qe?.stack }, "[BP8] queue.add FAILED");
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: `Queue add failed: ${qe?.message ?? "Unknown"}`,
        },
      });
      throw queueError;
    }
    logger.info({ requestId, jobId: job.id }, "[BP8] queue.add succeeded");

    logger.info({ requestId, jobId: job.id }, "[BP9] sending response");
    reply.status(202).send({
      jobId: job.id,
      status: "PENDING",
    });
    logger.info({ requestId }, "[BP9] response sent");
  } catch (error: unknown) {
    const e = error as Error;
    logger.error(
      { requestId, err: error, name: e?.name, message: e?.message, stack: e?.stack, startupId, userId, prompt: prompt?.substring(0, 100) },
      "[BP-ERR] handler failed",
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