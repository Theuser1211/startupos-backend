import { prisma } from "../../db/client.js";

function generateWins(industry: string): string[] {
  const wins: Record<string, string[]> = {
    "SaaS / Software": [
      "Product roadmap aligned with Q3 priorities",
      "Completed customer discovery interviews with 5 prospects",
      "Reduced infrastructure costs by 15%",
    ],
    FinTech: [
      "Completed initial compliance review",
      "Established partnership with payment processor",
      "Built fraud detection prototype",
    ],
    HealthTech: [
      "HIPAA compliance checklist completed",
      "Clinical pilot interest from 3 hospitals",
      "Patient data pipeline validated",
    ],
    "AI / ML / Infrastructure": [
      "Core model training pipeline completed",
      "Benchmark results 20% above baseline",
      "Published technical blog post on architecture",
    ],
  };

  return wins[industry] ?? [
    "Completed initial market research",
    "Gathered feedback from 5 potential customers",
    "Defined MVP scope and timeline",
  ];
}

function generatePriorities(industry: string): string[] {
  const priorities: Record<string, string[]> = {
    "SaaS / Software": [
      "Finalize pricing tiers for launch",
      "Onboard 10 beta users this month",
      "Implement analytics dashboard",
    ],
    FinTech: [
      "Complete SOC2 Type I audit preparation",
      "Finalize fee structure and revenue model",
      "Launch developer documentation portal",
    ],
    HealthTech: [
      "Complete HIPAA compliance implementation",
      "Submit IRB application for clinical study",
      "Integrate with major EHR systems",
    ],
    "AI / ML / Infrastructure": [
      "Optimize model inference latency",
      "Expand training dataset by 50%",
      "Build monitoring and alerting system",
    ],
  };

  return priorities[industry] ?? [
    "Validate core assumptions with customer interviews",
    "Build MVP with top 3 features",
    "Develop go-to-market strategy",
  ];
}

function generateCompetitorUpdates(industry: string): string[] {
  const updates: Record<string, string[]> = {
    "SaaS / Software": [
      "Competitor launched AI-powered analytics feature",
      "Market leader announced price increase of 20%",
      "New entrant raised $50M in Series B funding",
    ],
    FinTech: [
      "Stripe launched new embedded finance APIs",
      "Regulatory changes favor open banking startups",
      "Competitor acquired for $2B to expand market share",
    ],
    HealthTech: [
      "Major EHR provider opened API platform",
      "FDA released new guidelines for digital health tools",
      "Telehealth competitor expanded to 3 new states",
    ],
    "AI / ML / Infrastructure": [
      "Open-source alternative reached 100K GitHub stars",
      "Cloud provider reduced GPU pricing by 30%",
      "New model achieves state-of-the-art on key benchmark",
    ],
  };

  return updates[industry] ?? [
    "Industry seeing increased M&A activity",
    "New competitor entered the space with fresh funding",
    "Key player announced strategic platform shift",
  ];
}

export async function generateBrief(startupId: string) {
  const startup = await prisma.startup.findUnique({
    where: { id: startupId },
    select: { id: true },
  });

  if (!startup) return null;

  const blueprint = await prisma.blueprint.findUnique({
    where: { startupId },
    select: { content: true },
  });

  const industry = (blueprint?.content as { industry?: string } | null)?.industry ?? "SaaS / Software";

  const summary = `Your startup is in the ${industry} space. Here's your daily brief covering wins, priorities, competitor updates, and health score.`;
  const wins = generateWins(industry);
  const priorities = generatePriorities(industry);
  const competitorUpdates = generateCompetitorUpdates(industry);
  const healthScore = Math.floor(Math.random() * 40) + 50;

  const now = new Date();
  const healthHistory = Array.from({ length: 7 }, (_, i) => ({
    score: Math.max(10, Math.min(100, healthScore + Math.floor(Math.random() * 20) - 10)),
    createdAt: new Date(now.getTime() - (6 - i) * 86400000).toISOString(),
  }));

  return {
    id: startupId,
    summary,
    wins,
    priorities,
    competitorUpdates,
    healthScore,
    healthHistory,
    generatedAt: now.toISOString(),
  };
}
