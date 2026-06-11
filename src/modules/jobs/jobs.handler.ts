import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db/client.js";
import { NotFoundError, ForbiddenError } from "../../lib/errors.js";

export async function getJobHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const userId = request.user!.userId;

  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      startup: { select: { userId: true } },
    },
  });

  if (!job) {
    throw new NotFoundError("Job");
  }

  if (job.startup.userId !== userId) {
    throw new ForbiddenError("You do not own this job");
  }

  reply.send({
    job: {
      id: job.id,
      type: job.type,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
}