export interface AIProvider {
  name: string;
  generateBlueprint(prompt: string): Promise<BlueprintResult>;
  generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult>;
}

export interface BlueprintResult {
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

export interface WebsiteSpecResult {
  pages: PageSpec[];
  theme: ThemeSpec;
  components: ComponentSpec[];
}

export interface PageSpec {
  name: string;
  slug: string;
  sections: SectionSpec[];
}

export interface SectionSpec {
  type: string;
  order: number;
  content: Record<string, unknown>;
}

export interface ThemeSpec {
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  borderRadius: string;
}

export interface ComponentSpec {
  name: string;
  type: string;
  props: Record<string, unknown>;
}

export interface WebsiteResult {
  pages: PageResult[];
  assets: AssetResult[];
}

export interface PageResult {
  name: string;
  slug: string;
  html: string;
  css: string;
  js: string;
}

export interface AssetResult {
  path: string;
  content: string;
}