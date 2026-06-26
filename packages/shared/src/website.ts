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

export interface WebsiteSpecResult {
  pages: PageSpec[];
  theme: ThemeSpec;
  components: ComponentSpec[];
}

export interface PageHTMLResult {
  slug: string;
  title: string;
  html: string;
}

export interface WebsiteResult {
  pages: PageHTMLResult[];
  css: string;
  js: string;
}

export interface GenerateWebsitePayload {
  startupId: string;
}

export interface GenerateWebsiteResponse {
  website?: {
    id: string;
    name?: string;
    content?: unknown;
    spec?: unknown;
    deployment?: unknown;
    status?: string;
    createdAt: string;
    updatedAt: string;
    startupId: string;
  };
  message?: string;
}

export interface DeployPayload {
  websiteId: string;
}

export interface DeployResponse {
  success?: boolean;
  url?: string;
  deployment_url?: string;
  status?: string;
  error?: string;
  verified?: boolean;
}

export interface DeploymentInfo {
  id: string;
  status: string;
  url?: string | null;
  provider?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  websiteId: string;
}

export type DeploymentStatus = "pending" | "building" | "deployed" | "failed";

export interface Website {
  id: string;
  name?: string;
  content?: WebsiteResult | null;
  spec?: WebsiteSpecResult | null;
  deployment?: DeploymentInfo | null;
  status?: string;
  createdAt: string;
  updatedAt: string;
  startupId: string;
}

export interface WebsiteResponse {
  website: Website;
}
