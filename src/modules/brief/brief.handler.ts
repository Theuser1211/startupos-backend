import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { NotFoundError, ForbiddenError } from "../../lib/errors.js";
import { generateBrief } from "./brief.service.js";

export async function getBriefHandler(
  request: FastifyRequest<{ Params: { startupId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { startupId } = request.params;
  const userId = request.user!.userId;

  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    select: { id: true, userId: true },
  });

  if (!startup) throw new NotFoundError("Startup");
  if (startup.userId !== userId) throw new ForbiddenError("You do not own this startup");

  const brief = await generateBrief(startupId);
  if (!brief) throw new NotFoundError("Brief");

  reply.send(brief);
}
