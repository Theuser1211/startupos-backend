import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { NotFoundError, ForbiddenError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { Prisma } from "@prisma/client";
import { buildDeployFiles } from "../../services/deploy/builder.js";
import { VercelProvider } from "../../services/deploy/vercel.js";
import { verifyDeployment } from "../../services/deploy/verify.js";
import { env } from "../../lib/env.js";
import { captureEvent } from "../dashboard/dashboard.service.js";

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

    logger.warn({ jobId: result.job.id, websiteId }, "Async deployments disabled - job created but not queued");

    reply.status(503).send({
      success: false,
      message: "Async deployments temporarily disabled",
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existingDeployment = await prisma.deployment.findUnique({
        where: { websiteId },
      });
      reply.send({
        deployment: existingDeployment,
        message: "Website already deployed",
      });
      return;
    }
    throw error;
  }
}

export async function deployWebsiteHandler(
  request: FastifyRequest<{ Body: { websiteId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { websiteId } = request.body;
  const userId = request.user!.userId;

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    include: {
      startup: { select: { userId: true, name: true } },
    },
  });

  if (!website) {
    throw new NotFoundError("Website");
  }

  if (website.startup.userId !== userId) {
    throw new ForbiddenError("You do not own this website");
  }

  const existingDeployment = await prisma.deployment.findUnique({
    where: { websiteId },
  });

  if (existingDeployment?.status === "LIVE" && existingDeployment.url) {
    reply.send({
      deployment: existingDeployment,
      message: "Website already deployed",
    });
    return;
  }

  const websiteContent = website.content as unknown as import("../../types/ai.js").WebsiteResult;
  if (!websiteContent?.pages || websiteContent.pages.length === 0) {
    throw new Error("Website has no rendered content");
  }

  const deployment = await prisma.deployment.create({
    data: {
      status: "BUILDING",
      websiteId,
    },
  });

  try {
    const files = buildDeployFiles(websiteContent);
    logger.info({ websiteId, fileCount: files.length }, "Built deploy files");

    let url: string;
    let provider: string;
    let verified = false;

    if (env.VERCEL_TOKEN) {
      const vercelProvider = new VercelProvider();
      const result = await vercelProvider.deploy(files, website.startup.name);

      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: "DEPLOYING", url: result.url, provider: result.provider },
      });

      const verification = await verifyDeployment(vercelProvider, result.url);

      if (verification.reachable && verification.hasContent) {
        verified = true;
      }

      url = result.url;
      provider = result.provider;
    } else {
      url = `https://${websiteId}.startupos.app`;
      provider = "mock";
    }

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "LIVE", url, provider },
    });

    await captureEvent(website.startupId, "WEBSITE_DEPLOYED", { websiteId, url, provider, verified });

    logger.info({ deploymentId: deployment.id, url, provider, verified }, "Deployment completed");

    reply.send({
      deployment: {
        id: deployment.id,
        status: "LIVE",
        url,
        provider,
      },
      verified,
      message: verified ? "Website deployed and verified" : "Website deployed (unverified)",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: "FAILED", error: message },
    });

    await captureEvent(website.startupId, "DEPLOYMENT_FAILED", { websiteId, error: message });

    logger.error({ deploymentId: deployment.id, error: message }, "Deployment failed");

    reply.status(500).send({
      error: message,
      deployment: {
        id: deployment.id,
        status: "FAILED",
        error: message,
      },
    });
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