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
      { jobId: job?.id, error: err?.message, stack: err?.stack },
      "Worker job failed permanently",
    );
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
    logger.info({ jobId: job.data.jobId, startupId, promptLength: prompt?.length }, "Calling generateBlueprintWithFallback");
    const blueprint = await generateBlueprintWithFallback(prompt);
    console.log("[BP-DATA] blueprint from provider", JSON.stringify(blueprint, null, 2));
    console.log("[BP-DATA] blueprint keys", Object.keys(blueprint));
    console.log("[BP-DATA] blueprint type", typeof blueprint);
    logger.info({ jobId: job.data.jobId, blueprintKeys: Object.keys(blueprint), blueprintName: blueprint?.name }, "generateBlueprintWithFallback returned");

    // Evidence: force deterministic JSON serialization so we know exactly what we persist
    const contentToPersist: unknown = JSON.parse(JSON.stringify(blueprint));

    logger.info(
      `[BP-DATA] contentToPersist before Prisma jobId=${job.data.jobId} type=${typeof contentToPersist} isArray=${Array.isArray(contentToPersist)} keys=${
        contentToPersist && typeof contentToPersist === "object" && !Array.isArray(contentToPersist)
          ? Object.keys(contentToPersist as object).length
          : 0
      }`,
    );
    console.log("[BP-DATA] contentToPersist (stringified)", JSON.stringify(contentToPersist, null, 2));

    const createPayload = {
      startupId,
      content: contentToPersist as unknown as Prisma.InputJsonValue,
    };

    logger.info(
      `[BP-DATA] prisma create payload summary jobId=${job.data.jobId} payloadKeys=${Object.keys(createPayload).join(",")} contentKeys=${
        createPayload.content && typeof createPayload.content === "object" && !Array.isArray(createPayload.content)
          ? Object.keys(createPayload.content as object).length
          : 0
      }`,
    );
    console.log("[BP-DATA] prisma create payload", JSON.stringify(createPayload, null, 2));

    const created = await prisma.blueprint.create({ data: createPayload });

    logger.info(
      `[BP-DATA] created blueprint content summary jobId=${job.data.jobId} contentType=${typeof created.content} isArray=${Array.isArray(
        created.content as unknown as object,
      )} keys=${
        created.content && typeof created.content === "object" && !Array.isArray(created.content as unknown as object)
          ? Object.keys(created.content as unknown as object).length
          : 0
      }`,
    );
    console.log("[BP-DATA] created blueprint content", JSON.stringify(created.content, null, 2));

    logger.info(
      `[BP-DATA] Blueprint created in DB jobId=${job.data.jobId} blueprintId=${created.id} keys=${
        created.content && typeof created.content === "object" && !Array.isArray(created.content as unknown as object)
          ? Object.keys(created.content as unknown as object).length
          : 0
      }`,
    );

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
      logger.warn("VERCEL_TOKEN not set, using mock deployment URL");
      const mockUrl = `https://${websiteId}.startupos.app`;

      await prisma.deployment.updateMany({
        where: { id: deploymentId, status: "BUILDING" },
        data: { status: "LIVE", url: mockUrl, provider: "mock" },
      });

      await prisma.job.update({
        where: { id: job.data.jobId },
        data: {
          status: "COMPLETED",
          result: { deploymentId, url: mockUrl, provider: "mock", verified: false } as unknown as Prisma.InputJsonValue,
        },
      });

      logger.info({ jobId: job.data.jobId, deploymentId, url: mockUrl }, "Mock deployment completed");
    }
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
