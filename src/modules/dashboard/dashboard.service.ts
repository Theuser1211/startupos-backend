import { prisma } from "../../db/client.js";
import { logger } from "../../lib/logger.js";

export interface HealthScoreResult {
  score: number;
  breakdown: {
    foundational: number;
    product: number;
    launch: number;
    engagement: number;
  };
}

export interface ActionItem {
  action: string;
  description: string;
  priority: "high" | "medium" | "low";
  link: string | null;
}

export async function computeHealthScore(startupId: string): Promise<HealthScoreResult> {
  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    include: {
      blueprint: { select: { id: true } },
      websites: {
        include: { deployment: { select: { id: true, status: true } } },
      },
      events: {
        where: { createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
        select: { id: true },
      },
    },
  });

  if (!startup) {
    return { score: 0, breakdown: { foundational: 0, product: 0, launch: 0, engagement: 0 } };
  }

  let foundational = 0;
  let product = 0;
  let launch = 0;
  let engagement = 0;

  if (startup.blueprint) foundational = 25;

  if (startup.websites.length > 0) product = 25;

  const hasLiveDeployment = startup.websites.some(
    (w) => w.deployment?.status === "LIVE",
  );
  if (hasLiveDeployment) launch = 25;

  if (startup.events.length > 0) engagement = 25;

  const score = foundational + product + launch + engagement;

  return { score, breakdown: { foundational, product, launch, engagement } };
}

export async function generateActions(startupId: string): Promise<ActionItem[]> {
  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    include: {
      blueprint: { select: { id: true } },
      websites: {
        include: { deployment: { select: { id: true, status: true } } },
      },
      events: {
        where: { createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
        select: { id: true },
      },
    },
  });

  if (!startup) return [];

  const actions: ActionItem[] = [];
  const hasBlueprint = !!startup.blueprint;
  const hasWebsite = startup.websites.length > 0;
  const hasLiveDeployment = startup.websites.some(
    (w) => w.deployment?.status === "LIVE",
  );
  const hasRecentActivity = startup.events.length > 0;

  if (!hasBlueprint) {
    actions.push({
      action: "Complete Founder Interview",
      description: "Answer a few questions to generate your startup blueprint — the foundation of your business plan.",
      priority: "high",
      link: "/interview",
    });
  }

  if (hasBlueprint && !hasWebsite) {
    actions.push({
      action: "Generate Your Website",
      description: "Create a professional landing page from your blueprint to establish your online presence.",
      priority: "high",
      link: `/workspace?id=${startupId}`,
    });
  }

  if (hasWebsite && !hasLiveDeployment) {
    const websiteId = startup.websites[0]?.id;
    actions.push({
      action: "Deploy Your Website",
      description: "Launch your website live with one click and share it with the world.",
      priority: "medium",
      link: `/workspace?id=${startupId}`,
    });
  }

  if (!hasRecentActivity) {
    actions.push({
      action: "Check Your Dashboard",
      description: "Visit regularly to track your startup's health score and see personalized recommendations.",
      priority: "low",
      link: `/dashboard?id=${startupId}`,
    });
  }

  return actions;
}

export async function captureEvent(
  startupId: string,
  type: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.startupEvent.create({
      data: {
        startupId,
        type: type as any,
        metadata: (metadata ?? {}) as any,
      },
    });
  } catch (error) {
    logger.error({ error, startupId, type }, "Failed to capture event");
  }
}

export async function persistActions(
  startupId: string,
  actions: ActionItem[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.founderAction.updateMany({
      where: { startupId, completed: false },
      data: { completed: true },
    });

    for (const action of actions) {
      await tx.founderAction.create({
        data: {
          startupId,
          action: action.action,
          description: action.description,
          priority: action.priority,
          link: action.link,
        },
      });
    }
  });
}
