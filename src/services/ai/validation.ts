import { z } from "zod";

export const BlueprintResultSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  industry: z.string().min(1),
  targetAudience: z.string().min(1),
  problemStatement: z.string().min(1),
  solution: z.string().min(1),
  keyFeatures: z.array(z.string()).min(1),
  techStack: z.array(z.string()).min(1),
  monetization: z.string().min(1),
  competitorAnalysis: z.array(z.string()).min(1),
  roadmap: z.array(z.string()).min(1),
});

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

export type ValidatedBlueprint = z.infer<typeof BlueprintResultSchema>;
export type ValidatedWebsiteSpec = z.infer<typeof WebsiteSpecResultSchema>;