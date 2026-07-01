export interface BrandIdentity {
  mission: string;
  values: string[];
  tone: string[];
  colors: Array<{ name: string; hex: string }>;
  typography: { heading: string; body: string };
}

export interface BlueprintContent {
  name: string;
  description: string;
  industry: string;
  targetAudience: string;
  problemStatement: string;
  solution: string;
  keyFeatures: string[];
  techStack: string[];
  monetization: string;
  competitorAnalysis: string[];
  roadmap: string[];
}

export type BlueprintResult = BlueprintContent;

export interface GenerateBlueprintPayload {
  startupId: string;
  prompt?: string;
}

export interface GenerateBlueprintResponse {
  blueprint?: {
    id: string;
    content: BlueprintContent;
    createdAt: string;
    updatedAt: string;
    startupId: string;
  };
  message?: string;
}

export interface Blueprint {
  id: string;
  content: BlueprintContent;
  createdAt: string;
  updatedAt: string;
  startupId: string;
}

export interface BlueprintResponse {
  blueprint: Blueprint;
}

export type BlueprintMeta = "pass" | "conditional" | "needs-work" | "fail";
