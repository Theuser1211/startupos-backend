import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { GenerateBlueprintInput } from "./blueprint.schema.js";
import { AppError, NotFoundError, ForbiddenError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { captureEvent } from "../dashboard/dashboard.service.js";
import { generateBlueprintWithFallback } from "../../services/ai/provider.js";
import { env } from "../../lib/env.js";

export async function generateBlueprintHandler(
  request: FastifyRequest<{ Body: GenerateBlueprintInput }>,
  reply: FastifyReply,
): Promise<void> {
  const requestId = request.id;
  const { startupId, prompt } = request.body;
  const userId = request.user!.userId;

  try {
    logger.info({ requestId, startupId, userId, promptLength: prompt?.length }, "[Blueprint] Request received");

    logger.info({ requestId, userId }, "[Blueprint] User authenticated");

    logger.info({ requestId, startupId }, "[Blueprint] Startup lookup start");
    const startup = await prisma.startup.findUnique({
      where: { id: startupId },
      select: { userId: true, name: true, description: true },
    });
    logger.info({ requestId, startupId, found: !!startup }, "[Blueprint] Startup lookup done");

    if (!startup) {
      logger.warn({ requestId, startupId }, "[Blueprint] Startup not found");
      throw new NotFoundError("Startup");
    }

    const effectivePrompt = prompt ?? startup.description ?? "";
    if (!effectivePrompt || effectivePrompt.length < 10) {
      logger.warn({ requestId, startupId, promptLength: effectivePrompt.length }, "[Blueprint] Prompt missing or too short");
      throw new Error("Prompt is required (provide in request or set startup description)");
    }

    logger.info({ requestId, startupId, ownerMatch: startup.userId === userId }, "[Blueprint] Ownership check passed");
    if (startup.userId !== userId) {
      logger.warn({ requestId, startupId, userId }, "[Blueprint] Ownership check failed");
      throw new ForbiddenError("You do not own this startup");
    }

    logger.info({ requestId, startupId }, "[Blueprint] Existing blueprint lookup start");
    const existingBlueprint = await prisma.blueprint.findUnique({
      where: { startupId },
    });
    logger.info({ requestId, startupId, exists: !!existingBlueprint }, "[Blueprint] Existing blueprint lookup done");

    if (existingBlueprint) {
      logger.info({ requestId, startupId }, "[Blueprint] Returning existing blueprint");
      await captureEvent(startupId, "BLUEPRINT_GENERATED", { existing: true });
      reply.send({ blueprint: existingBlueprint });
      return;
    }

    logger.info({ requestId, startupId, promptLength: effectivePrompt.length, timeoutMs: env.AI_TIMEOUT_MS }, "[Blueprint] AI call start");
    const blueprintContent = await generateBlueprintWithFallback(effectivePrompt, startup.name, startup.description || undefined);
    logger.info({ requestId, startupId, name: blueprintContent.name, industry: blueprintContent.industry, featureCount: blueprintContent.keyFeatures?.length }, "[Blueprint] AI call completed");

    logger.info({ requestId, startupId }, "[Blueprint] Parse succeeded");

    logger.info({ requestId, startupId }, "[Blueprint] Persistence start");
    const blueprint = await prisma.blueprint.create({
      data: {
        startupId,
        content: blueprintContent as unknown as object,
      },
    });
    logger.info({ requestId, startupId, blueprintId: blueprint.id }, "[Blueprint] Persistence succeeded");

    await captureEvent(startupId, "BLUEPRINT_GENERATED", { blueprintId: blueprint.id });

    logger.info({ requestId, startupId, blueprintId: blueprint.id }, "[Blueprint] Response sent");
    reply.send({ blueprint });
  } catch (error: unknown) {
    logger.error(
      {
        error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        startupId,
        userId,
      },
      "[Blueprint-FATAL]",
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
    where: { startupId: id },
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

  const payload = { blueprint };

  reply.send(payload);
}
