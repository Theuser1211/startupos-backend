import { prisma } from "../../db/client.js";
import { logger } from "../../lib/logger.js";

function generateMockSnapshot(name: string, website: string) {
  const domain = website.replace(/https?:\/\//, "").split("/")[0];
  return {
    title: `${name} — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
    summary: `${name} is a company in the ${domain} space.`,
    pricing: "Contact for pricing",
    features: {
      core: ["Product offering", "Customer support", "Documentation"],
      integrations: [],
      platforms: ["Web"],
    },
    rawContent: `Mock snapshot for ${name} at ${website}. No external API configured.`,
  };
}

function generateMockChanges(existingSnapshot: { title: string } | null) {
  if (!existingSnapshot) return [];

  return [
    {
      type: "pricing",
      oldValue: null,
      newValue: "Contact for pricing",
    },
    {
      type: "feature",
      oldValue: null,
      newValue: "New product offering detected",
    },
  ];
}

export async function addCompetitor(
  startupId: string,
  data: { name: string; website: string; description?: string },
) {
  const competitor = await prisma.competitor.create({
    data: {
      startupId,
      name: data.name,
      website: data.website,
      description: data.description ?? null,
    },
  });

  const mockSnapshot = generateMockSnapshot(data.name, data.website);

  const latestSnapshot = await prisma.competitorSnapshot.findFirst({
    where: { competitorId: competitor.id },
    orderBy: { capturedAt: "desc" },
  });

  const snapshot = await prisma.competitorSnapshot.create({
    data: {
      competitorId: competitor.id,
      title: mockSnapshot.title,
      summary: mockSnapshot.summary,
      pricing: mockSnapshot.pricing,
      features: mockSnapshot.features,
      rawContent: mockSnapshot.rawContent,
    },
  });

  const changes = generateMockChanges(latestSnapshot);
  for (const change of changes) {
    await prisma.competitorChange.create({
      data: {
        competitorId: competitor.id,
        type: change.type,
        oldValue: change.oldValue,
        newValue: change.newValue,
      },
    });
  }

  logger.info({ competitorId: competitor.id, startupId }, "Competitor added with mock snapshot");

  return competitor;
}

function generateMockCompetitors(industry: string) {
  const mockCompetitors: Record<string, { name: string; website: string; description: string }[]> = {
    "SaaS / Software": [
      { name: "ProductPlan", website: "https://productplan.com", description: "Roadmap and product management platform" },
      { name: "LaunchKit", website: "https://launchkit.io", description: "Product launch toolkit for startups" },
      { name: "FounderHub", website: "https://founderhub.io", description: "All-in-one platform for early-stage founders" },
    ],
    FinTech: [
      { name: "Plaid", website: "https://plaid.com", description: "Financial services API platform" },
      { name: "Stripe", website: "https://stripe.com", description: "Online payment processing platform" },
      { name: "Brex", website: "https://brex.com", description: "Corporate credit cards and financial services" },
    ],
    HealthTech: [
      { name: "Oscar Health", website: "https://hioscar.com", description: "Health insurance platform" },
      { name: "Zocdoc", website: "https://zocdoc.com", description: "Doctor appointment booking platform" },
    ],
    "AI / ML / Infrastructure": [
      { name: "Hugging Face", website: "https://huggingface.co", description: "AI model hosting and collaboration platform" },
      { name: "Replicate", website: "https://replicate.com", description: "Cloud API for running AI models" },
    ],
    "Developer Tools": [
      { name: "Vercel", website: "https://vercel.com", description: "Frontend deployment and hosting platform" },
      { name: "Railway", website: "https://railway.app", description: "Full-stack application hosting platform" },
    ],
    "E-Commerce / Retail": [
      { name: "Shopify", website: "https://shopify.com", description: "E-commerce platform for online stores" },
      { name: "BigCommerce", website: "https://bigcommerce.com", description: "Enterprise e-commerce platform" },
    ],
  };

  return mockCompetitors[industry] ?? [
    { name: "MarketLeader", website: "https://marketleader.com", description: "Industry leading platform" },
    { name: "CompetitorCo", website: "https://competitor.co", description: "Direct competitor in the space" },
  ];
}

export async function getCompetitorsForStartup(startupId: string) {
  try {
    const rows = await prisma.competitor.findMany({
      where: { startupId },
      orderBy: { createdAt: "desc" },
      include: {
        snapshots: {
          orderBy: { capturedAt: "desc" },
          take: 1,
        },
        changes: {
          orderBy: { detectedAt: "desc" },
          take: 3,
        },
      },
    });

    const mapped = rows.map((c) => ({
      id: c.id,
      name: c.name,
      website: c.website,
      description: c.description,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      latestSnapshot: c.snapshots[0]
        ? {
            id: c.snapshots[0].id,
            title: c.snapshots[0].title,
            summary: c.snapshots[0].summary,
            pricing: c.snapshots[0].pricing,
            features: c.snapshots[0].features,
            rawContent: c.snapshots[0].rawContent,
            capturedAt: c.snapshots[0].capturedAt.toISOString(),
          }
        : null,
      changes: c.changes.map((ch) => ({
        id: ch.id,
        type: ch.type,
        oldValue: ch.oldValue,
        newValue: ch.newValue,
        detectedAt: ch.detectedAt.toISOString(),
      })),
    }));

    if (mapped.length > 0) return mapped;

    const blueprint = await prisma.blueprint.findUnique({
      where: { startupId },
      select: { content: true },
    });

    const industry = (blueprint?.content as { industry?: string } | null)?.industry ?? "SaaS / Software";
    const mocks = generateMockCompetitors(industry);

    return mocks.map((m) => ({
      id: `mock-${m.name.toLowerCase().replace(/\s+/g, "-")}`,
      name: m.name,
      website: m.website,
      description: m.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latestSnapshot: {
        id: `mock-snap-${m.name.toLowerCase().replace(/\s+/g, "-")}`,
        title: `${m.name} — ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
        summary: `${m.name} is a company in the ${industry} space.`,
        pricing: "Contact for pricing",
        features: { core: ["Product offering", "Customer support", "Documentation"], integrations: [], platforms: ["Web"] },
        rawContent: `Mock snapshot for ${m.name} at ${m.website}. No external API configured.`,
        capturedAt: new Date().toISOString(),
      },
      changes: [
        { id: `mock-chg-${m.name.toLowerCase().replace(/\s+/g, "-")}-1`, type: "pricing", oldValue: null, newValue: "Contact for pricing", detectedAt: new Date().toISOString() },
      ],
    }));
  } catch (err) {
    logger.error(err, "Failed to get competitors for startup");
    return [];
  }
}

export async function getCompetitorHistory(competitorId: string) {
  const competitor = await prisma.competitor.findUnique({
    where: { id: competitorId },
    include: {
      snapshots: {
        orderBy: { capturedAt: "desc" },
      },
      changes: {
        orderBy: { detectedAt: "desc" },
      },
    },
  });

  if (!competitor) return null;

  return {
    competitor: {
      id: competitor.id,
      name: competitor.name,
      website: competitor.website,
      description: competitor.description,
      createdAt: competitor.createdAt.toISOString(),
      updatedAt: competitor.updatedAt.toISOString(),
    },
    snapshots: competitor.snapshots.map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      pricing: s.pricing,
      features: s.features,
      rawContent: s.rawContent,
      capturedAt: s.capturedAt.toISOString(),
    })),
    changes: competitor.changes.map((ch) => ({
      id: ch.id,
      type: ch.type,
      oldValue: ch.oldValue,
      newValue: ch.newValue,
      detectedAt: ch.detectedAt.toISOString(),
    })),
  };
}
