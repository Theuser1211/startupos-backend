import { prisma } from "../db/client.js";
import {
  generateBlueprintWithFallback,
  generateWebsiteSpecWithFallback,
} from "../services/ai/provider.js";
import { renderWebsite } from "../services/renderer/index.js";
import { buildDeployFiles } from "../services/deploy/builder.js";
import { VercelProvider } from "../services/deploy/vercel.js";
import { verifyDeployment } from "../services/deploy/verify.js";
import { logger } from "../lib/logger.js";
import { createWorker } from "./setup.js";
import { JobQueuePayload } from "../types/job.js";
import { Job } from "bullmq";
import { env } from "../lib/env.js";
import { Prisma } from "@prisma/client";

export function startWorker(): void {
  const worker = createWorker(async (job: Job<JobQueuePayload>) => {
    const { type, startupId, payload } = job.data;

    logger.info({ jobId: job.id, type, startupId }, "Worker picked up job");
    try {
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
      logger.info({ jobId: job.id, type }, "Worker job completed successfully");
    } catch (error) {
      logger.error(
        { err: error, jobId: job.id, type, startupId },
        "Worker job processing failed",
      );
      throw error;
    }
  });

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, jobData: job?.data, error: err?.message, stack: err?.stack },
      "Worker job failed permanently",
    );
  });

  logger.info({ concurrency: env.NODE_ENV === "production" ? 5 : 2, lockDuration: 30000 }, "Queue worker started");
}

async function isJobTerminal(jobId: string): Promise<boolean> {
  const current = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return current?.status === "COMPLETED" || current?.status === "FAILED";
}

async function handleBlueprintGeneration(
  job: Job<JobQueuePayload>,
  startupId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (await isJobTerminal(job.data.jobId)) {
    logger.info({ jobId: job.data.jobId }, "Blueprint job already in terminal state, skipping retry");
    return;
  }

  await prisma.job.update({
    where: { id: job.data.jobId },
    data: { status: "PROCESSING" },
  });
  logger.info({ jobId: job.data.jobId, startupId }, "Blueprint generation: status set to PROCESSING");

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
    logger.info(
      { jobId: job.data.jobId, startupId, promptLength: prompt?.length },
      "Blueprint generation: calling generateBlueprintWithFallback — provider chain will be tried: google → groq → nvidia → openrouter",
    );
    const blueprint = await generateBlueprintWithFallback(prompt);
    logger.info(
      { jobId: job.data.jobId, blueprintName: blueprint?.name, providerUsed: (blueprint as unknown as { _provider?: string })?._provider },
      "Blueprint generation: provider returned successfully",
    );

    // Evidence: force deterministic JSON serialization so we know exactly what we persist
    const contentToPersist: unknown = JSON.parse(JSON.stringify(blueprint));

    logger.debug({ jobId: job.data.jobId, type: typeof contentToPersist, keys: contentToPersist && typeof contentToPersist === "object" && !Array.isArray(contentToPersist) ? Object.keys(contentToPersist as object).length : 0 }, "Blueprint content to persist");

    const createPayload = {
      startupId,
      content: contentToPersist as unknown as Prisma.InputJsonValue,
    };

    logger.debug({ jobId: job.data.jobId, contentKeys: createPayload.content && typeof createPayload.content === "object" && !Array.isArray(createPayload.content) ? Object.keys(createPayload.content as object).length : 0 }, "Blueprint create payload");

    const created = await prisma.blueprint.create({ data: createPayload });

    logger.debug({ jobId: job.data.jobId, blueprintId: created.id, keys: created.content && typeof created.content === "object" && !Array.isArray(created.content as unknown as object) ? Object.keys(created.content as unknown as object).length : 0 }, "Blueprint persisted");

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
    const stack = error instanceof Error ? error.stack : undefined;

    const providerInfo = error instanceof Error && error.message?.match(/\[(GoogleAIStudio|Groq|NVIDIA|OpenRouter|FreeLLMAPI)\]/);
    const provider = providerInfo ? providerInfo[1] : "unknown";

    logger.error(
      {
        jobId: job.data.jobId,
        startupId,
        error: message,
        stack,
        provider,
        errorName: error instanceof Error ? error.name : typeof error,
        phase: "ai_generation",
      },
      "Blueprint generation: provider execution failed",
    );

    try {
      await prisma.job.update({
        where: { id: job.data.jobId },
        data: {
          status: "FAILED",
          error: `[${provider}] ${message}`,
        },
      });
      logger.info({ jobId: job.data.jobId, startupId, provider, error: message }, "Blueprint job: marked FAILED in database");
    } catch (dbError) {
      logger.error(
        { jobId: job.data.jobId, startupId, dbError, originalError: message },
        "Blueprint job: failed to persist FAILED status to database",
      );
    }

    throw error;
  }
}

async function handleWebsiteGeneration(
  job: Job<JobQueuePayload>,
  startupId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (await isJobTerminal(job.data.jobId)) {
    logger.info({ jobId: job.data.jobId }, "Website job already in terminal state, skipping retry");
    return;
  }

  await prisma.job.update({
    where: { id: job.data.jobId },
    data: { status: "PROCESSING" },
  });
  logger.info({ jobId: job.data.jobId, startupId }, "Website generation: status set to PROCESSING");

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

    logger.info(
      { jobId: job.data.jobId, pages: websiteSpec.pages.length },
      "WebsiteSpec generated, starting page rendering",
    );

    const renderResult = await renderWebsite(bpContent, websiteSpec);

    const website = await prisma.website.create({
      data: {
        name: startupName,
        content: renderResult.website as unknown as Prisma.InputJsonValue,
        status: "rendered",
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
        result: {
          websiteId: website.id,
          pagesGenerated: renderResult.stats.pagesGenerated,
          pagesFallback: renderResult.stats.pagesFallback,
          total: renderResult.stats.total,
          fallbackPages: renderResult.stats.fallbackPages,
          warnings: renderResult.stats.warnings,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info(
      {
        jobId: job.data.jobId,
        websiteId: website.id,
        pagesGenerated: renderResult.stats.pagesGenerated,
        pagesFallback: renderResult.stats.pagesFallback,
      },
      "Website generation completed",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    try {
      await prisma.job.update({
        where: { id: job.data.jobId },
        data: {
          status: "FAILED",
          error: message,
        },
      });
      logger.info({ jobId: job.data.jobId, error: message }, "Website generation job failed");
    } catch (dbError) {
      logger.error(
        { jobId: job.data.jobId, dbError, originalError: message },
        "Website generation job: failed to persist FAILED status to database",
      );
    }

    throw error;
  }
}

async function handleDeployment(
  job: Job<JobQueuePayload>,
  startupId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (await isJobTerminal(job.data.jobId)) {
    logger.info({ jobId: job.data.jobId }, "Deployment job already in terminal state, skipping retry");
    return;
  }

  await prisma.job.update({
    where: { id: job.data.jobId },
    data: { status: "PROCESSING" },
  });
  logger.info({ jobId: job.data.jobId, startupId }, "Deployment: status set to PROCESSING");

  const websiteId = payload.websiteId as string;
  const deploymentId = payload.deploymentId as string;

  await prisma.deployment.update({
    where: { id: deploymentId },
    data: { status: "BUILDING" },
  });

  try {
    const dep = await prisma.deployment.findUnique({ where: { id: deploymentId } });
    if (dep?.status === "LIVE" && dep.url) {
      await prisma.job.update({
        where: { id: job.data.jobId },
        data: {
          status: "COMPLETED",
          result: { deploymentId, url: dep.url, provider: dep.provider } as unknown as Prisma.InputJsonValue,
        },
      });
      return;
    }

    const website = await prisma.website.findUnique({ where: { id: websiteId } });
    if (!website) {
      throw new Error("Website not found");
    }

    const websiteContent = website.content as unknown as import("../types/ai.js").WebsiteResult;
    if (!websiteContent?.pages || websiteContent.pages.length === 0) {
      throw new Error("Website has no rendered content");
    }

    const files = buildDeployFiles(websiteContent);
    logger.info(
      { jobId: job.data.jobId, deploymentId, fileCount: files.length },
      "Built deployment files",
    );

    if (env.VERCEL_TOKEN) {
      const provider = new VercelProvider();
      const result = await provider.deploy(files, website.name);

      await prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          status: "DEPLOYING",
          url: result.url,
          provider: result.provider,
        },
      });

      logger.info({ deploymentId, url: result.url }, "Deployed to Vercel, verifying...");

      const verification = await verifyDeployment(provider, result.url);

      if (verification.reachable && verification.hasContent) {
        await prisma.deployment.updateMany({
          where: { id: deploymentId, status: "DEPLOYING" },
          data: { status: "LIVE" },
        });

        await prisma.job.update({
          where: { id: job.data.jobId },
          data: {
            status: "COMPLETED",
            result: {
              deploymentId,
              url: result.url,
              provider: result.provider,
              verified: true,
              statusCode: verification.statusCode,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        logger.info({ jobId: job.data.jobId, deploymentId, url: result.url }, "Deployment completed and verified");
      } else {
        throw new Error(`Deployment verification failed: status=${verification.statusCode} hasContent=${verification.hasContent}`);
      }
    } else {
      throw new Error("Deployment not configured: VERCEL_TOKEN is not set");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    try {
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: "FAILED", error: message },
      });
    } catch (dbError) {
      logger.error(
        { deploymentId, dbError, originalError: message },
        "Deployment job: failed to persist deployment FAILED status",
      );
    }

    try {
      await prisma.job.update({
        where: { id: job.data.jobId },
        data: {
          status: "FAILED",
          error: message,
        },
      });
      logger.info({ jobId: job.data.jobId, deploymentId, error: message }, "Deployment job failed");
    } catch (dbError) {
      logger.error(
        { jobId: job.data.jobId, dbError, originalError: message },
        "Deployment job: failed to persist job FAILED status",
      );
    }

    throw error;
  }
}
