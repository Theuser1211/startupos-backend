import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { GenerateBlueprintInput } from "./blueprint.schema.js";
import { AppError, NotFoundError, ForbiddenError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { generateBlueprintWithFallback } from "../../services/ai/provider.js";

export async function generateBlueprintHandler(
  request: FastifyRequest<{ Body: GenerateBlueprintInput }>,
  reply: FastifyReply,
): Promise<void> {
  const requestId = request.id;
  const { startupId, prompt } = request.body;
  const userId = request.user!.userId;

  try {
    logger.info({ requestId, startupId, userId, promptLength: prompt?.length }, "[BP] request received");

    logger.info({ requestId, userId }, "[BP] user authenticated");

    logger.info({ requestId, startupId }, "[BP] startup lookup start");
    const startup = await prisma.startup.findUnique({
      where: { id: startupId },
      select: { userId: true, description: true },
    });
    logger.info({ requestId, startupId, found: !!startup }, "[BP] startup lookup done");

    if (!startup) {
      logger.warn({ requestId, startupId }, "[BP] startup not found");
      throw new NotFoundError("Startup");
    }

    const effectivePrompt = prompt ?? startup.description ?? "";
    if (!effectivePrompt || effectivePrompt.length < 10) {
      logger.warn({ requestId, startupId }, "[BP] prompt missing or too short");
      throw new Error("Prompt is required (provide in request or set startup description)");
    }

    logger.info({ requestId, startupId, ownerMatch: startup.userId === userId }, "[BP] ownership check passed");
    if (startup.userId !== userId) {
      logger.warn({ requestId, startupId, userId }, "[BP] ownership check failed");
      throw new ForbiddenError("You do not own this startup");
    }

    logger.info({ requestId, startupId }, "[BP] existing blueprint lookup start");
    const existingBlueprint = await prisma.blueprint.findUnique({
      where: { startupId },
    });
    logger.info({ requestId, startupId, exists: !!existingBlueprint }, "[BP] existing blueprint lookup done");

    if (existingBlueprint) {
      logger.info({ requestId, startupId }, "[BP] returning existing blueprint");

      reply.send({ blueprint: existingBlueprint });
      return;
    }

    logger.info({ requestId, startupId, promptLength: effectivePrompt.length }, "[BP] AI provider call start");
    const blueprintContent = await generateBlueprintWithFallback(effectivePrompt);
    logger.info({ requestId, startupId, name: blueprintContent.name }, "[BP] AI provider call succeeded");

    logger.info({ requestId, startupId }, "[BP] blueprint persistence start");
    const blueprint = await prisma.blueprint.create({
      data: {
        startupId,
        content: blueprintContent as unknown as object,
      },
    });
    logger.info({ requestId, startupId, blueprintId: blueprint.id }, "[BP] blueprint persistence succeeded");

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
      "[BP-FATAL]",
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
