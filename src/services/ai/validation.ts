import { z } from "zod";

export const BrandIdentitySchema = z.object({
  mission: z.string().min(1),
  values: z.array(z.string().min(1)).min(2).max(8),
  tone: z.array(z.string().min(1)).min(2).max(8),
  colors: z.array(z.object({
    name: z.string().min(1),
    hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
  })).min(3).max(6),
  typography: z.object({
    heading: z.string().min(1),
    body: z.string().min(1),
  }),
});

export const BlueprintResultSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  industry: z.string().min(1),
  targetAudience: z.string().min(1),
  problemStatement: z.string().min(1),
  solution: z.string().min(1),
  keyFeatures: z.array(z.union([z.string(), z.object({ name: z.string().optional(), description: z.string().optional() })])).min(1),
  techStack: z.array(z.union([z.string(), z.object({ name: z.string().optional(), description: z.string().optional() })])).min(1),
  monetization: z.string().min(1),
  competitorAnalysis: z.array(z.union([z.string(), z.object({ name: z.string().optional(), description: z.string().optional() })])).min(1),
  roadmap: z.array(z.union([z.string(), z.object({ name: z.string().optional(), description: z.string().optional() })])).min(1),
  brand: BrandIdentitySchema.optional(),
});

function normalizeStringArray(arr: unknown[]): string[] {
  return arr.map((item) => {
    if (typeof item === "string") return item;
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      if (typeof obj.name === "string") return obj.name;
      if (typeof obj.description === "string") return obj.description;
      return JSON.stringify(item);
    }
    return String(item);
  });
}

export function normalizeBlueprint(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    keyFeatures: Array.isArray(raw.keyFeatures) ? normalizeStringArray(raw.keyFeatures) : raw.keyFeatures,
    techStack: Array.isArray(raw.techStack) ? normalizeStringArray(raw.techStack) : raw.techStack,
    competitorAnalysis: Array.isArray(raw.competitorAnalysis) ? normalizeStringArray(raw.competitorAnalysis) : raw.competitorAnalysis,
    roadmap: Array.isArray(raw.roadmap) ? normalizeStringArray(raw.roadmap) : raw.roadmap,
  };
}

export function extractJSON(raw: string): string | null {
  let cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  cleaned = cleaned.substring(firstBrace, lastBrace + 1);

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    const noTrailingCommas = cleaned.replace(/,(\s*[}\]])/g, "$1");
    try {
      JSON.parse(noTrailingCommas);
      return noTrailingCommas;
    } catch {
      try {
        JSON.parse(cleaned.replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":'));
        return cleaned;
      } catch {
        return cleaned;
      }
    }
  }
}

export const SectionSpecSchema = z.object({
  type: z.string().min(1),
  order: z.number().int().nonnegative(),
  content: z.record(z.unknown()),
});

export const PageSpecSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  sections: z.array(SectionSpecSchema).min(1),
});

export const ThemeSpecSchema = z.object({
  primaryColor: z.string().min(1),
  secondaryColor: z.string().min(1),
  fontFamily: z.string().min(1),
  borderRadius: z.string().min(1),
});

export const ComponentSpecSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  props: z.record(z.unknown()),
});

export const WebsiteSpecResultSchema = z.object({
  pages: z.array(PageSpecSchema).min(1),
  theme: ThemeSpecSchema,
  components: z.array(ComponentSpecSchema),
});

export const PageHTMLResultSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  html: z
    .string()
    .min(500, "HTML too short — likely truncated or malformed")
    .refine(
      (html) => html.includes("<!DOCTYPE html") || html.includes("<html"),
      "HTML must contain <!DOCTYPE html> or <html> tag",
    )
    .refine((html) => html.includes("<head"), "HTML must contain <head> section")
    .refine((html) => html.includes("<body"), "HTML must contain <body> section")
    .refine(
      (html) => html.includes("</html>"),
      "HTML must be a complete document (closing </html> tag)",
    ),
});

export const WebsiteResultSchema = z.object({
  pages: z.array(PageHTMLResultSchema).min(1),
  css: z.string().default(""),
  js: z.string().default(""),
});

export type ValidatedBlueprint = z.infer<typeof BlueprintResultSchema>;
export type ValidatedWebsiteSpec = z.infer<typeof WebsiteSpecResultSchema>;
export type ValidatedPageHTML = z.infer<typeof PageHTMLResultSchema>;
export type ValidatedWebsiteResult = z.infer<typeof WebsiteResultSchema>;
