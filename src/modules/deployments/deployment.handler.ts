import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { NotFoundError, ForbiddenError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { getQueue } from "../../queue/setup.js";
import { Prisma } from "@prisma/client";

export async function createDeploymentHandler(
  request: FastifyRequest<{ Body: { websiteId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { websiteId } = request.body;
  const userId = request.user!.userId;

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    include: {
      startup: { select: { userId: true } },
    },
  });

  if (!website) {
    throw new NotFoundError("Website");
  }

  if (website.startup.userId !== userId) {
    throw new ForbiddenError("You do not own this website");
  }

  const existingJob = await prisma.job.findFirst({
    where: {
      startupId: website.startupId,
      type: "DEPLOYMENT",
      status: { in: ["PENDING", "PROCESSING"] },
    },
  });

  if (existingJob) {
    reply.status(202).send({
      jobId: existingJob.id,
      status: existingJob.status,
      message: "Deployment already in progress",
    });
    return;
  }

  const existingDeployment = await prisma.deployment.findUnique({
    where: { websiteId },
  });

  if (existingDeployment) {
    reply.send({
      jobId: null,
      deployment: existingDeployment,
      message: "Website already deployed",
    });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const deployment = await tx.deployment.create({
        data: {
          status: "PENDING",
          websiteId,
        },
      });

      const job = await tx.job.create({
        data: {
          type: "DEPLOYMENT",
          status: "PENDING",
          payload: { websiteId, deploymentId: deployment.id },
          startupId: website.startupId,
        },
      });

      return { deployment, job };
    });

    const queue = getQueue();
    await queue.add("deployment", {
      jobId: result.job.id,
      startupId: website.startupId,
      userId,
      type: "DEPLOYMENT",
      payload: { websiteId, deploymentId: result.deployment.id },
    });

    logger.info({ jobId: result.job.id, websiteId }, "Deployment job queued");

    reply.status(202).send({
      jobId: result.job.id,
      status: "PENDING",
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existingDeployment = await prisma.deployment.findUnique({
        where: { websiteId },
      });
      reply.send({
        jobId: null,
        deployment: existingDeployment,
        message: "Website already deployed",
      });
      return;
    }
    throw error;
  }
}

export async function getDeploymentHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const userId = request.user!.userId;

  const deployment = await prisma.deployment.findUnique({
    where: { id },
    include: {
      website: {
        include: {
          startup: { select: { userId: true } },
        },
      },
    },
  });

  if (!deployment) {
    throw new NotFoundError("Deployment");
  }

  if (deployment.website.startup.userId !== userId) {
    throw new ForbiddenError("You do not own this deployment");
  }

  reply.send({ deployment });
}