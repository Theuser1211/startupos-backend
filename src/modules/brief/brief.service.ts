import { prisma } from "../../db/client.js";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateMarketNews(industry: string): { title: string; source: string; url: string; relevance: string }[] {
  const news: Record<string, { title: string; source: string; url: string; relevance: string }[]> = {
    "SaaS / Software": [
      { title: "SaaS market projected to reach $1 trillion by 2030", source: "Gartner", url: "https://gartner.com", relevance: "high" },
      { title: "AI-powered SaaS tools seeing 3x faster adoption rates", source: "TechCrunch", url: "https://techcrunch.com", relevance: "high" },
      { title: "Enterprise software spending up 12% in Q2", source: "Forbes", url: "https://forbes.com", relevance: "medium" },
    ],
    FinTech: [
      { title: "FinTech investment rebounds with $15B in Q1 2026", source: "CB Insights", url: "https://cbinsights.com", relevance: "high" },
      { title: "Digital banking adoption reaches 78% globally", source: "Statista", url: "https://statista.com", relevance: "high" },
      { title: "Regulatory changes open new opportunities for FinTech startups", source: "Bloomberg", url: "https://bloomberg.com", relevance: "medium" },
    ],
    HealthTech: [
      { title: "Digital health market to exceed $500B by 2028", source: "Grand View Research", url: "https://grandviewresearch.com", relevance: "high" },
      { title: "Telehealth visits stabilize at 30x pre-pandemic levels", source: "McKinsey", url: "https://mckinsey.com", relevance: "medium" },
    ],
    "AI / ML / Infrastructure": [
      { title: "AI infrastructure spend to hit $200B in 2026", source: "IDC", url: "https://idc.com", relevance: "high" },
      { title: "Open-source AI models closing gap with proprietary systems", source: "VentureBeat", url: "https://venturebeat.com", relevance: "high" },
    ],
  };

  return news[industry] ?? [
    { title: `${industry} industry showing steady growth in 2026`, source: "Industry Report", url: "https://example.com", relevance: "medium" },
    { title: `Key trends shaping the ${industry} landscape`, source: "Market Analysis", url: "https://example.com", relevance: "medium" },
  ];
}

function generateOpportunities(industry: string): { area: string; description: string; impact: string; effort: string }[] {
  const base = [
    { area: "Early Adopter Program", description: "Launch a beta program targeting startups in your network to gather feedback and build reference customers.", impact: "high", effort: "low" },
    { area: "Content Marketing", description: "Publish thought leadership content about your niche to establish authority and drive organic traffic.", impact: "medium", effort: "low" },
    { area: "Strategic Partnerships", description: "Partner with complementary service providers to expand reach and offer bundled solutions.", impact: "high", effort: "medium" },
    { area: "Community Building", description: "Create a community for founders at your stage to foster engagement and organic growth.", impact: "medium", effort: "medium" },
    { area: "Product Expansion", description: `Extend your offering with ${industry}-specific features your competitors lack.`, impact: "high", effort: "high" },
  ];
  return base;
}

function generateRisks(industry: string): { category: string; description: string; severity: string; mitigation: string }[] {
  const risks: Record<string, { category: string; description: string; severity: string; mitigation: string }[]> = {
    "SaaS / Software": [
      { category: "Competition", description: "Established players are adding AI features rapidly", severity: "high", mitigation: "Focus on vertical-specific solutions they overlook" },
      { category: "Churn", description: "SMBs have high price sensitivity and may churn quickly", severity: "medium", mitigation: "Build stickiness through onboarding and usage-based value" },
      { category: "Funding", description: "VC funding for early-stage SaaS has tightened", severity: "medium", mitigation: "Pursue revenue-first growth and extend runway" },
    ],
    FinTech: [
      { category: "Regulation", description: "Evolving regulatory landscape could increase compliance costs", severity: "high", mitigation: "Invest in compliance infrastructure early" },
      { category: "Security", description: "Financial data handling requires robust security measures", severity: "high", mitigation: "Implement SOC2 compliance from day one" },
    ],
    HealthTech: [
      { category: "Regulation", description: "HIPAA compliance adds complexity and cost", severity: "high", mitigation: "Budget for compliance from the start" },
      { category: "Adoption", description: "Healthcare providers are slow to adopt new technology", severity: "medium", mitigation: "Focus on easy-to-integrate solutions" },
    ],
  };

  return risks[industry] ?? [
    { category: "Market Timing", description: `The ${industry} market may not be ready for your solution`, severity: "medium", mitigation: "Validate demand through pre-sales and pilot programs" },
    { category: "Execution", description: "Resource constraints could delay product milestones", severity: "medium", mitigation: "Prioritize MVP features and iterate based on feedback" },
    { category: "Competition", description: "New entrants and incumbents may crowd the space", severity: "medium", mitigation: "Differentiate through superior customer experience" },
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

  const summary = `Your startup is in the ${industry} space. Here's your daily brief covering market news, opportunities, and risks to watch.`;

  const marketNews = generateMarketNews(industry);
  const opportunities = generateOpportunities(industry);
  const risks = generateRisks(industry);

  return {
    summary,
    marketNews,
    opportunities,
    risks,
    generatedAt: new Date().toISOString(),
  };
}
