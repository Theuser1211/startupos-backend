import { prisma } from "../db/client.js";
import { generateBlueprintWithFallback, generateWebsiteSpecWithFallback } from "../services/ai/provider.js";
import { logger } from "../lib/logger.js";
import { createWorker } from "./setup.js";
import { JobQueuePayload } from "../types/job.js";
import { Job } from "bullmq";
import { Prisma } from "@prisma/client";

export function startWorker(): void {
  createWorker(async (job: Job<JobQueuePayload>) => {
    const { type, startupId, payload } = job.data;

    switch (type) {
      case "BLUEPRINT_GENERATION": {
        await handleBlueprintGeneration(job, startupId, payload);
        break;
      }
      case "WEBSITE_GENERATION": {
        await handleWebsiteGeneration(job, startupId, payload);
        break;
      }
      case "DEPLOYMENT": {
        await handleDeployment(job, startupId, payload);
        break;
      }
      default: {
        throw new Error(`Unknown job type: ${type}`);
      }
    }
  });

  logger.info("Queue worker started");
}

async function isJobAlreadyCompleted(jobId: string): Promise<boolean> {
  const current = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return current?.status === "COMPLETED";
}

async function handleBlueprintGeneration(
  job: Job<JobQueuePayload>,
  startupId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (await isJobAlreadyCompleted(job.data.jobId)) {
    logger.info({ jobId: job.data.jobId }, "Blueprint job already completed, skipping retry");
    return;
  }

  await prisma.job.update({
    where: { id: job.data.jobId },
    data: { status: "PROCESSING" },
  });

  try {
    const existing = await prisma.blueprint.findUnique({ where: { startupId } });
    if (existing) {
      await prisma.job.update({
        where: { id: job.data.jobId },
        data: {
          status: "COMPLETED",
          result: { blueprintId: existing.id, note: "already existed" } as unknown as Prisma.InputJsonValue,
        },
      });
      return;
    }

    const prompt = payload.prompt as string;
    const blueprint = await generateBlueprintWithFallback(prompt);

    const created = await prisma.blueprint.create({
      data: {
        startupId,
        content: blueprint as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.job.update({
      where: { id: job.data.jobId },
      data: {
        status: "COMPLETED",
        result: { blueprintId: created.id } as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info({ jobId: job.data.jobId, blueprintId: created.id }, "Blueprint generation completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    await prisma.job.update({
      where: { id: job.data.jobId },
      data: {
        status: "FAILED",
        error: message,
      },
    });

    throw error;
  }
}

async function handleWebsiteGeneration(
  job: Job<JobQueuePayload>,
  startupId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (await isJobAlreadyCompleted(job.data.jobId)) {
    logger.info({ jobId: job.data.jobId }, "Website job already completed, skipping retry");
    return;
  }

  await prisma.job.update({
    where: { id: job.data.jobId },
    data: { status: "PROCESSING" },
  });

  try {
    const blueprintId = payload.blueprintId as string;
    const startupName = (payload.startupName as string) || "Untitled";

    const blueprint = await prisma.blueprint.findUnique({
      where: { id: blueprintId },
    });

    if (!blueprint) {
      throw new Error("Blueprint not found");
    }

    const existing = await prisma.website.findFirst({
      where: { startupId, spec: { isNot: null } },
    });
    if (existing) {
      await prisma.job.update({
        where: { id: job.data.jobId },
        data: {
          status: "COMPLETED",
          result: { websiteId: existing.id, note: "already existed" } as unknown as Prisma.InputJsonValue,
        },
      });
      return;
    }

    const bpContent = blueprint.content as unknown as Parameters<typeof generateWebsiteSpecWithFallback>[0];
    const websiteSpec = await generateWebsiteSpecWithFallback(bpContent);

    const website = await prisma.website.create({
      data: {
        name: startupName,
        content: {} as unknown as Prisma.InputJsonValue,
        status: "spec_generated",
        startupId,
        spec: {
          create: {
            content: websiteSpec as unknown as Prisma.InputJsonValue,
          },
        },
      },
    });

    await prisma.job.update({
      where: { id: job.data.jobId },
      data: {
        status: "COMPLETED",
        result: { websiteId: website.id } as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info({ jobId: job.data.jobId, websiteId: website.id }, "Website generation completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    await prisma.job.update({
      where: { id: job.data.jobId },
      data: {
        status: "FAILED",
        error: message,
      },
    });

    throw error;
  }
}

async function handleDeployment(
  job: Job<JobQueuePayload>,
  startupId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (await isJobAlreadyCompleted(job.data.jobId)) {
    logger.info({ jobId: job.data.jobId }, "Deployment job already completed, skipping retry");
    return;
  }

  await prisma.job.update({
    where: { id: job.data.jobId },
    data: { status: "PROCESSING" },
  });

  const websiteId = payload.websiteId as string;
  const deploymentId = payload.deploymentId as string;

  await prisma.deployment.update({
    where: { id: deploymentId },
    data: { status: "BUILDING" },
  });

  try {
    const dep = await prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (dep?.status === "LIVE") {
      await prisma.job.update({
        where: { id: job.data.jobId },
        data: {
          status: "COMPLETED",
          result: { deploymentId, url: dep.url } as unknown as Prisma.InputJsonValue,
        },
      });
      return;
    }

    const updated = await prisma.deployment.updateMany({
      where: { id: deploymentId, status: "BUILDING" },
      data: { status: "LIVE", url: `https://${websiteId}.startupos.app` },
    });

    if (updated.count === 0) {
      throw new Error("Deployment state transition invalid: expected BUILDING");
    }

    await prisma.job.update({
      where: { id: job.data.jobId },
      data: {
        status: "COMPLETED",
        result: { deploymentId, url: `https://${websiteId}.startupos.app` } as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info({ jobId: job.data.jobId, deploymentId }, "Deployment completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: "FAILED", error: message },
    });

    await prisma.job.update({
      where: { id: job.data.jobId },
      data: {
        status: "FAILED",
        error: message,
      },
    });

    throw error;
  }
}