import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { GenerateWebsiteInput } from "./website.schema.js";
import { NotFoundError, ForbiddenError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { captureEvent } from "../dashboard/dashboard.service.js";
import { generateWebsiteSpecWithFallback } from "../../services/ai/provider.js";
import { renderWebsite } from "../../services/renderer/index.js";
import type { BlueprintResult, WebsiteSpecResult } from "../../types/ai.js";

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

  const existingWebsite = await prisma.website.findFirst({
    where: { startupId },
    include: { spec: true, deployment: true },
  });

  if (existingWebsite) {
    logger.info({ startupId, websiteId: existingWebsite.id }, "Website already exists, returning existing");
    reply.send({ website: existingWebsite });
    return;
  }

  const blueprint = await prisma.blueprint.findUnique({
    where: { startupId },
  });

  if (!blueprint) {
    throw new NotFoundError("Blueprint. Generate a blueprint first.");
  }

  const bpContent = blueprint.content as unknown as BlueprintResult;

  logger.info({ startupId }, "[SYNC] calling AI provider for website spec");
  const websiteSpec = await generateWebsiteSpecWithFallback(bpContent);
  logger.info({ startupId, pages: websiteSpec.pages.length }, "[SYNC] website spec generated");

  const renderResult = await renderWebsite(bpContent, websiteSpec);
  logger.info({ startupId, pagesGenerated: renderResult.stats.pagesGenerated }, "[SYNC] website rendered");

  const website = await prisma.website.create({
    data: {
      name: startup.name,
      content: renderResult.website as unknown as object,
      status: "rendered",
      startupId,
      spec: {
        create: {
          content: websiteSpec as unknown as object,
        },
      },
    },
    include: { spec: true, deployment: true },
  });

  await captureEvent(startupId, "WEBSITE_GENERATED", { websiteId: website.id });

  logger.info({ websiteId: website.id, startupId }, "[SYNC] website persisted");

  reply.send({ website });
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
