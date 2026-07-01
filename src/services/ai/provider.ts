import {
  AIProvider,
  BlueprintResult,
  WebsiteSpecResult,
  PageSpec,
  PageHTMLResult,
  ThemeSpec,
  SectionSpec,
} from "../../types/ai.js";
import { env } from "../../lib/env.js";
import { logger } from "../../lib/logger.js";
import {
  BlueprintResultSchema,
  WebsiteSpecResultSchema,
  PageHTMLResultSchema,
  MinimalWebsiteContentSchema,
  ValidatedBlueprint,
  ValidatedWebsiteSpec,
  ValidatedPageHTML,
  normalizeBlueprint,
  extractJSON,
} from "./validation.js";
import type { MinimalWebsiteContent } from "./validation.js";
import { ZodError } from "zod";
import { providerRegistry } from "./provider-registry.js";

const TIMEOUT_MS = env.AI_TIMEOUT_MS;

function buildMinimalWebsitePrompt(blueprint: BlueprintResult) {
  return `You are a startup copywriter. Given a startup blueprint, generate ONLY the following JSON.
Return ONLY valid JSON — no markdown, no explanation, no code fences.

RULES:
- Use ONLY data from the blueprint. Never fabricate testimonials, statistics, metrics, logos, customer names, or made-up numbers.
- Features must be specific to THIS startup, not generic.
- primaryColor should be a hex color appropriate for ${blueprint.industry || "technology"}.
- tone should be one of: professional, friendly, bold, warm, technical, or playful.

{
  "headline": "A specific, benefit-driven headline",
  "subheadline": "Clear value proposition expanding headline",
  "about": "A 2-3 sentence description of what the startup does using only blueprint data",
  "features": ["feature 1", "feature 2", "feature 3", "feature 4", "feature 5"],
  "ctaText": "Action-oriented CTA text",
  "primaryColor": "#HEXCOLOR",
  "tone": "professional"
}

Blueprint:
Name: ${blueprint.name}
Description: ${blueprint.description}
Industry: ${blueprint.industry}
Problem: ${blueprint.problemStatement}
Solution: ${blueprint.solution}
Key Features: ${(blueprint.keyFeatures || []).map(f => typeof f === "string" ? f : (f as Record<string,unknown>).name || JSON.stringify(f)).join(", ")}
Target Audience: ${blueprint.targetAudience}`;
}

function enrichMinimalToFullSpec(
  minimal: MinimalWebsiteContent,
  blueprint: BlueprintResult,
): WebsiteSpecResult {
  const features = minimal.features.map((f) => ({ title: f, description: "" }));
  const industryColors: Record<string, { primary: string; secondary: string }> = {
    fintech: { primary: "#0F766E", secondary: "#14B8A6" },
    healthcare: { primary: "#059669", secondary: "#10B981" },
    devtools: { primary: "#2563EB", secondary: "#7C3AED" },
    "ai-ml": { primary: "#7C3AED", secondary: "#2563EB" },
    ecommerce: { primary: "#E11D48", secondary: "#BE185D" },
    education: { primary: "#7C3AED", secondary: "#8B5CF6" },
    security: { primary: "#1E293B", secondary: "#475569" },
    creative: { primary: "#EC4899", secondary: "#F43F5E" },
    enterprise: { primary: "#4F46E5", secondary: "#6366F1" },
  };
  const industry = (blueprint.industry || "").toLowerCase();
  let colorKey = "enterprise";
  if (industry.includes("fin")) colorKey = "fintech";
  else if (industry.includes("health")) colorKey = "healthcare";
  else if (industry.includes("dev") || industry.includes("saas") || industry.includes("tech")) colorKey = "devtools";
  else if (industry.includes("ai") || industry.includes("ml")) colorKey = "ai-ml";
  else if (industry.includes("ecom") || industry.includes("retail")) colorKey = "ecommerce";
  else if (industry.includes("edu")) colorKey = "education";
  else if (industry.includes("sec") || industry.includes("cyber")) colorKey = "security";
  else if (industry.includes("creative") || industry.includes("design")) colorKey = "creative";
  const colors = industryColors[colorKey];

  const sections: SectionSpec[] = [
    {
      type: "hero",
      order: 1,
      content: {
        headline: minimal.headline,
        subheadline: minimal.subheadline,
        ctaText: minimal.ctaText,
        ctaSecondary: "Learn More",
      },
    },
  ];

  let order = 2;
  if (blueprint.problemStatement && blueprint.problemStatement.length > 10) {
    sections.push({
      type: "problem",
      order: order++,
      content: {
        headline: `The ${blueprint.industry || "industry"} challenge`,
        description: blueprint.problemStatement,
        painPoints: [
          blueprint.problemStatement.length > 120
            ? blueprint.problemStatement.substring(0, 120) + "..."
            : blueprint.problemStatement,
        ],
      },
    });
  }

  if (blueprint.solution && blueprint.solution.length > 10) {
    const keyFeatureNames = (blueprint.keyFeatures || []).slice(0, 4).map((f) =>
      typeof f === "string" ? f : String((f as Record<string, unknown>).name || f),
    );
    sections.push({
      type: "solution",
      order: order++,
      content: {
        headline: `How ${blueprint.name} solves this`,
        description: blueprint.solution,
        benefits: keyFeatureNames.length > 0 ? keyFeatureNames : [blueprint.solution.substring(0, 120)],
      },
    });
  }

  sections.push({
    type: "features",
    order: order++,
    content: {
      title: "Features",
      subtitle: `What ${blueprint.name} offers`,
      items: features,
    },
  });

  sections.push({
    type: "cta",
    order: order++,
    content: {
      headline: `Ready to start with ${blueprint.name}?`,
      subheadline: minimal.subheadline,
      ctaText: minimal.ctaText,
    },
  });

  return {
    pages: [
      {
        name: "Home",
        slug: "/",
        sections,
      },
    ],
    theme: {
      primaryColor: minimal.primaryColor || colors.primary,
      secondaryColor: colors.secondary,
      fontFamily: "Inter",
      borderRadius: "12px",
    },
    components: [
      { name: "Navbar", type: "navigation", props: {} },
      { name: "Footer", type: "footer", props: {} },
    ],
  };
}

export abstract class BaseAIProvider implements AIProvider {
  abstract name: string;

  abstract generateBlueprint(prompt: string): Promise<BlueprintResult>;
  abstract generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult>;
  abstract generateWebsitePage(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Promise<PageHTMLResult>;

  protected async callAPI(
    endpoint: string,
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    maxTokens = 8192,
    temperature = 0.3,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);

    try {
      logger.info({ provider: this.name, url: endpoint, model, maxTokens, temperature }, "[Blueprint] Sending request");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : 2000;
          logger.warn({ provider: this.name, retryAfter: delay, elapsedMs: Date.now() - 0 }, "[Blueprint] Rate limited — skipping this provider");
          throw new AIProviderError(this.name, 429, `Rate limited (retry after ${delay}ms)`);
        }
        const errorBody = await response.text();
        logger.error({ provider: this.name, status: response.status, errorBody: errorBody.substring(0, 500) }, "[Blueprint] Provider returned error");
        throw new AIProviderError(this.name, response.status, errorBody);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        logger.error({ provider: this.name, responseKeys: Object.keys(data) }, "[Blueprint] Empty content in provider response");
        throw new AIProviderError(this.name, 0, "Empty response from AI provider");
      }
      logger.info({ provider: this.name, responseLength: content.length, finishReason: data.choices?.[0]?.finish_reason }, "[Blueprint] Response received");
      return content;
    } catch (error) {
      logger.error({ provider: this.name, error, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, "[AI] provider failed");
      if (error instanceof AIProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AIProviderError(this.name, 0, `Request timed out after ${TIMEOUT_MS}ms`);
      }
      throw new AIProviderError(this.name, 0, `Network error: ${error instanceof Error ? error.message : "Unknown"}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  protected parseJSONResponse<T>(raw: string): T {
    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .replace(/^```|```$/g, "")
      .trim();
    if (!cleaned) {
      logger.error({ provider: this.name }, "[Blueprint] Empty response after cleaning markdown fences");
      throw new AIProviderError(this.name, 0, "Empty response after cleaning");
    }
    try {
      return JSON.parse(cleaned) as T;
    } catch (error) {
      const preview = cleaned.substring(0, 500);
      logger.error({ provider: this.name, rawPreview: preview }, "[Blueprint] JSON parse failed");
      throw new AIProviderError(this.name, 0, `JSON parse error: ${error instanceof Error ? error.message : "Unknown"} — preview: ${preview.substring(0, 200)}`);
    }
  }

  protected validateBlueprint(raw: string): ValidatedBlueprint {
    logger.debug({ rawLength: raw.length }, "Raw AI response for blueprint");
    const parsed = this.parseJSONResponse<Record<string, unknown>>(raw);
    logger.info({ parsedKeys: Object.keys(parsed) }, "Parsed blueprint object");
    const normalized = normalizeBlueprint(parsed);
    const validated = BlueprintResultSchema.parse(normalized);
    logger.debug({ validatedKeys: Object.keys(validated), validatedName: validated.name }, "Blueprint validated");
    return validated;
  }

  protected validateWebsiteSpec(raw: string): ValidatedWebsiteSpec {
    logger.debug({ rawLength: raw.length, rawPreview: raw.substring(0, 300) }, "[WEBSITE] raw model response");

    const extracted = extractJSON(raw);
    logger.debug({ extractedLength: extracted?.length, extractedPreview: extracted?.substring(0, 300) }, "[WEBSITE] extracted json");

    if (!extracted) {
      throw new AIProviderError(this.name, 0, "Failed to extract JSON from model response");
    }

    const parsed = this.parseJSONResponse<Record<string, unknown>>(extracted);

    try {
      return WebsiteSpecResultSchema.parse(parsed);
    } catch (error) {
      if (error instanceof ZodError) {
        logger.error({ zodErrors: error.errors }, "[WEBSITE] zod validation error");
      }
      throw error;
    }
  }

  protected validatePageHTML(raw: string): ValidatedPageHTML {
    const parsed = this.parseJSONResponse<Record<string, unknown>>(raw);
    return PageHTMLResultSchema.parse(parsed);
  }

  protected validateMinimalContent(raw: string): MinimalWebsiteContent {
    const extracted = extractJSON(raw);
    if (!extracted) {
      throw new AIProviderError(this.name, 0, "Failed to extract JSON");
    }
    const parsed = this.parseJSONResponse<Record<string, unknown>>(extracted);
    try {
      return MinimalWebsiteContentSchema.parse(parsed);
    } catch (error) {
      if (error instanceof ZodError) {
        logger.error({ zodErrors: error.errors }, "[WEBSITE] minimal content validation error");
      }
      throw error;
    }
  }

  protected buildPageGenerationPrompt(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Array<{ role: string; content: string }> {
    const sectionTypes = page.sections.map((s) => s.type).join(", ");
    const systemPrompt = `You are an expert web designer and developer. Generate a premium, YC-grade startup landing page.

CRITICAL: Return ONLY JSON: { "slug": "...", "title": "...", "html": "<!DOCTYPE html>..." }. No markdown, no explanation.

DESIGN STANDARDS:
- Visual hierarchy: Large bold headings (2.5rem-4rem), clear subheadings (1.1rem-1.25rem), readable body (0.95rem-1rem)
- Typography: Inter font, headings 700-800 weight, -0.02em to -0.04em letter-spacing, body 400 weight, 1.6-1.7 line-height
- Generous whitespace: 96-128px section padding, 32-40px between cards
- Cards: Clean white backgrounds, subtle borders (#e5e7eb), 12-16px radius, soft shadows on hover, translateY(-4px) lift
- Buttons: 12-14px vertical padding, 24-32px horizontal, 8-12px radius, 600 weight, translateY hover lift
- Dark mode via prefers-color-scheme: dark with proper dark surface/text/border colors
- Animations: fadeIn + translateY(24px) on section entrance, stagger delays (0.1s-0.3s)
- Responsive: 1024px (tablet grid), 768px (single column), 480px (compact padding)
- Gradient text effects on hero headlines
- Background gradients: radial gradient glow behind hero, linear gradient for CTA sections

SECTION-SPECIFIC LAYOUTS:
hero - Full-width with 50/50 split (text left, visual right). Badge above headline. Large headline with gradient text. Two CTAs. Decorative card stack or gradient shapes on right side.
features - Section title + subtitle centered. 3-column grid of feature cards. Each card: colored icon circle, heading, description text. Hover: lift + shadow.
pricing - Centered heading. 3-column grid of pricing cards. Featured tier with "Most Popular" badge. Price + period, feature list with checkmarks, CTA button. Clean card design.
faq - Centered heading. Accordion list: click question to expand answer with smooth height transition, chevron rotation.
problem/solution - Split section (50/50). Problem: pain point list with red X icons. Solution: checkmark list with primary color icons. Alternating layout.
cta - Full-width gradient banner (primary->secondary). Large white heading, subtext, white button with primary text. Radial glow overlay.
social-proof - Heading centered. Row of styled placeholder badges/logos.

Theme:
- Primary: ${spec.theme.primaryColor} (CTAs, accents, buttons, link hover)
- Secondary: ${spec.theme.secondaryColor} (gradients, decorative elements)
- Font: ${spec.theme.fontFamily}, border-radius: ${spec.theme.borderRadius}

Startup: ${blueprint.name} (${blueprint.industry})
Description: ${blueprint.description}
Key features: ${blueprint.keyFeatures.join(", ")}
Solution: ${blueprint.solution}

Page: "${page.name}" (${page.slug}), sections: ${sectionTypes}
Section content: ${JSON.stringify(page.sections)}

RULES:
- ALL CSS in <style> tag. ALL JS in <script> at end of body.
- NO external deps except Google Fonts (Inter).
- NO markdown fences, NO explanation text.
- Real marketing copy from startup context above. NOT generic placeholder text.
- Full <!DOCTYPE html> with proper <head> (meta charset, viewport, og tags, twitter card).
- Responsive at 1024px, 768px, 480px.
- Hover effects, smooth transitions, scroll animations.
- Dark mode via prefers-color-scheme: dark.
- NEVER generate fake testimonials, team members, stats, addresses, phone numbers, or company claims.
- NEVER use "revolutionary", "game-changing", "best-in-class", "cutting-edge", "next-generation".`;

    return [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Generate a premium ${page.name.toLowerCase()} page for ${blueprint.name}, a ${blueprint.industry} startup. Sections: ${sectionTypes}. Return ONLY the JSON.`,
      },
    ];
  }
}

export class AIProviderError extends Error {
  constructor(
    public provider: string,
    public statusCode: number,
    message: string,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "AIProviderError";
  }
}

export class FreeLLMProvider extends BaseAIProvider {
  name = "FreeLLMAPI";

  private get endpoint(): string {
    return "https://api.free-llm-api.com/v1/chat/completions";
  }

  async generateBlueprint(prompt: string): Promise<BlueprintResult> {
    const systemPrompt = `You are a startup blueprint generator. Given a startup idea, generate a comprehensive blueprint.
Do NOT include any text, explanation, or markdown before or after the JSON. Return ONLY the raw JSON object — nothing else.
Return ONLY valid JSON with this exact structure:
{
  "name": "Startup name",
  "description": "Short description",
  "industry": "Industry",
  "targetAudience": "Target audience description",
  "problemStatement": "Problem being solved",
  "solution": "Solution description",
  "keyFeatures": ["feature1", "feature2"],
  "techStack": ["tech1", "tech2"],
  "monetization": "Monetization strategy",
  "competitorAnalysis": ["competitor1", "competitor2"],
  "roadmap": ["milestone1", "milestone2"],
  "brand": {
    "mission": "Inspiring mission statement aligned with the startup's purpose",
    "values": ["Value1", "Value2", "Value3", "Value4"],
    "tone": ["Professional", "Approachable", "Confident", "Clear"],
    "colors": [
      { "name": "Primary", "hex": "#HEXCOLOR" },
      { "name": "Secondary", "hex": "#HEXCOLOR" },
      { "name": "Accent", "hex": "#HEXCOLOR" },
      { "name": "Neutral", "hex": "#HEXCOLOR" }
    ],
    "typography": {
      "heading": "Font name for headings",
      "body": "Font name for body text"
    }
  }
}`;

    const raw = await this.callAPI(
      this.endpoint,
      env.FREELLM_API_KEY!,
      "gpt-4o-mini",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    );

    logger.debug({ provider: this.name, rawLength: raw.length }, "Raw response from FreeLLM");
    const validated = this.validateBlueprint(raw) as unknown as BlueprintResult;
    return validated;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const prompt = buildMinimalWebsitePrompt(blueprint);
    const raw = await this.callAPI(
      this.endpoint,
      env.FREELLM_API_KEY!,
      "gpt-4o-mini",
      [
        { role: "system", content: "Return ONLY valid JSON matching the schema below. No markdown, no explanation." },
        { role: "user", content: prompt },
      ],
      800,
    );
    const minimal = this.validateMinimalContent(raw);
    return enrichMinimalToFullSpec(minimal, blueprint);
  }

  async generateWebsitePage(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Promise<PageHTMLResult> {
    const messages = this.buildPageGenerationPrompt(blueprint, spec, page);
    const raw = await this.callAPI(
      this.endpoint,
      env.FREELLM_API_KEY!,
      "gpt-4o-mini",
      messages,
      8192,
    );

    return this.validatePageHTML(raw) as unknown as PageHTMLResult;
  }
}

export class GroqProvider extends BaseAIProvider {
  name = "Groq";
  private _apiKey: string;

  constructor(apiKey?: string) {
    super();
    this._apiKey = apiKey || env.GROQ_API_KEY || "";
  }

  private get endpoint(): string {
    return "https://api.groq.com/openai/v1/chat/completions";
  }

  async generateBlueprint(prompt: string): Promise<BlueprintResult> {
    const systemPrompt = `You are a startup blueprint generator. Given a startup idea, generate a comprehensive blueprint.
Do NOT include any text, explanation, or markdown before or after the JSON. Return ONLY the raw JSON object — nothing else.
Return ONLY valid JSON with this exact structure:
{
  "name": "...",
  "description": "...",
  "industry": "...",
  "targetAudience": "...",
  "problemStatement": "...",
  "solution": "...",
  "keyFeatures": [...],
  "techStack": [...],
  "monetization": "...",
  "competitorAnalysis": [...],
  "roadmap": [...],
  "brand": {
    "mission": "Inspiring mission statement aligned with the startup's purpose",
    "values": ["Value1", "Value2", "Value3", "Value4"],
    "tone": ["Professional", "Approachable", "Confident", "Clear"],
    "colors": [
      { "name": "Primary", "hex": "#HEXCOLOR" },
      { "name": "Secondary", "hex": "#HEXCOLOR" },
      { "name": "Accent", "hex": "#HEXCOLOR" },
      { "name": "Neutral", "hex": "#HEXCOLOR" }
    ],
    "typography": {
      "heading": "Font name for headings",
      "body": "Font name for body text"
    }
  }
}`;

    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "llama-3.3-70b-versatile",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    );

    logger.debug({ provider: this.name, rawLength: raw.length }, "Raw response from Groq");
    const validated = this.validateBlueprint(raw) as unknown as BlueprintResult;
    return validated;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const prompt = buildMinimalWebsitePrompt(blueprint);
    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "llama-3.3-70b-versatile",
      [
        { role: "system", content: "Return ONLY valid JSON matching the schema below. No markdown, no explanation." },
        { role: "user", content: prompt },
      ],
      800,
    );
    const minimal = this.validateMinimalContent(raw);
    return enrichMinimalToFullSpec(minimal, blueprint);
  }

  async generateWebsitePage(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Promise<PageHTMLResult> {
    const messages = this.buildPageGenerationPrompt(blueprint, spec, page);
    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "llama-3.3-70b-versatile",
      messages,
      8192,
    );

    return this.validatePageHTML(raw) as unknown as PageHTMLResult;
  }
}

export class OpenRouterProvider extends BaseAIProvider {
  name = "OpenRouter";
  private _apiKey: string;

  constructor(apiKey?: string) {
    super();
    this._apiKey = apiKey || env.OPENROUTER_API_KEY || "";
  }

  private get endpoint(): string {
    return "https://openrouter.ai/api/v1/chat/completions";
  }

  async generateBlueprint(prompt: string): Promise<BlueprintResult> {
    const systemPrompt = `You are a startup blueprint generator. Given a startup idea, generate a comprehensive blueprint.
Do NOT include any text, explanation, or markdown before or after the JSON. Return ONLY the raw JSON object — nothing else.
Return ONLY valid JSON with this exact structure:
{
  "name": "...",
  "description": "...",
  "industry": "...",
  "targetAudience": "...",
  "problemStatement": "...",
  "solution": "...",
  "keyFeatures": [...],
  "techStack": [...],
  "monetization": "...",
  "competitorAnalysis": [...],
  "roadmap": [...],
  "brand": {
    "mission": "Inspiring mission statement aligned with the startup's purpose",
    "values": ["Value1", "Value2", "Value3", "Value4"],
    "tone": ["Professional", "Approachable", "Confident", "Clear"],
    "colors": [
      { "name": "Primary", "hex": "#HEXCOLOR" },
      { "name": "Secondary", "hex": "#HEXCOLOR" },
      { "name": "Accent", "hex": "#HEXCOLOR" },
      { "name": "Neutral", "hex": "#HEXCOLOR" }
    ],
    "typography": {
      "heading": "Font name for headings",
      "body": "Font name for body text"
    }
  }
}`;

    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "openai/gpt-4o",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    );

    logger.debug({ provider: this.name, rawLength: raw.length }, "Raw response from OpenRouter");
    const validated = this.validateBlueprint(raw) as unknown as BlueprintResult;
    return validated;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const prompt = buildMinimalWebsitePrompt(blueprint);
    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "openai/gpt-4o",
      [
        { role: "system", content: "Return ONLY valid JSON matching the schema below. No markdown, no explanation." },
        { role: "user", content: prompt },
      ],
      800,
    );
    const minimal = this.validateMinimalContent(raw);
    return enrichMinimalToFullSpec(minimal, blueprint);
  }

  async generateWebsitePage(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Promise<PageHTMLResult> {
    const messages = this.buildPageGenerationPrompt(blueprint, spec, page);
    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "openai/gpt-4o",
      messages,
      8192,
    );

    return this.validatePageHTML(raw) as unknown as PageHTMLResult;
  }
}

export class GoogleAIStudioProvider extends BaseAIProvider {
  name = "GoogleAIStudio";
  private _apiKey: string;

  constructor(apiKey: string) {
    super();
    this._apiKey = apiKey;
  }

  private get endpoint(): string {
    return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  }

  async generateBlueprint(prompt: string): Promise<BlueprintResult> {
    const systemPrompt = `You are a startup blueprint generator. Given a startup idea, generate a comprehensive blueprint.
Do NOT include any text, explanation, or markdown before or after the JSON. Return ONLY the raw JSON object — nothing else.
Return ONLY valid JSON with this exact structure:
{
  "name": "...",
  "description": "...",
  "industry": "...",
  "targetAudience": "...",
  "problemStatement": "...",
  "solution": "...",
  "keyFeatures": [...],
  "techStack": [...],
  "monetization": "...",
  "competitorAnalysis": [...],
  "roadmap": [...],
  "brand": {
    "mission": "Inspiring mission statement aligned with the startup's purpose",
    "values": ["Value1", "Value2", "Value3", "Value4"],
    "tone": ["Professional", "Approachable", "Confident", "Clear"],
    "colors": [
      { "name": "Primary", "hex": "#HEXCOLOR" },
      { "name": "Secondary", "hex": "#HEXCOLOR" },
      { "name": "Accent", "hex": "#HEXCOLOR" },
      { "name": "Neutral", "hex": "#HEXCOLOR" }
    ],
    "typography": {
      "heading": "Font name for headings",
      "body": "Font name for body text"
    }
  }
}`;

    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "gemini-2.0-flash",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    );

    logger.debug({ provider: this.name, rawLength: raw.length }, "Raw response from GoogleAIStudio");
    return this.validateBlueprint(raw) as unknown as BlueprintResult;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const prompt = buildMinimalWebsitePrompt(blueprint);
    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "gemini-2.0-flash",
      [
        { role: "system", content: "Return ONLY valid JSON matching the schema below. No markdown, no explanation." },
        { role: "user", content: prompt },
      ],
      800,
    );
    const minimal = this.validateMinimalContent(raw);
    return enrichMinimalToFullSpec(minimal, blueprint);
  }

  async generateWebsitePage(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Promise<PageHTMLResult> {
    const messages = this.buildPageGenerationPrompt(blueprint, spec, page);
    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "gemini-2.0-flash",
      messages,
      8192,
    );

    return this.validatePageHTML(raw) as unknown as PageHTMLResult;
  }
}

export class NVIDIAProvider extends BaseAIProvider {
  name = "NVIDIA";
  private _apiKey: string;
  private _model: string;

  constructor(apiKey: string, model?: string) {
    super();
    this._apiKey = apiKey;
    this._model = model ?? "nvidia/nvidia-nemotron-nano-9b-v2";
  }

  private get endpoint(): string {
    return "https://integrate.api.nvidia.com/v1/chat/completions";
  }

  async generateBlueprint(prompt: string): Promise<BlueprintResult> {
    const systemPrompt = `You are a startup blueprint generator. Given a startup idea, generate a comprehensive blueprint.
Do NOT include any text, explanation, or markdown before or after the JSON. Return ONLY the raw JSON object — nothing else.
Return ONLY valid JSON with this exact structure:
{
  "name": "...",
  "description": "...",
  "industry": "...",
  "targetAudience": "...",
  "problemStatement": "...",
  "solution": "...",
  "keyFeatures": [...],
  "techStack": [...],
  "monetization": "...",
  "competitorAnalysis": [...],
  "roadmap": [...],
  "brand": {
    "mission": "Inspiring mission statement aligned with the startup's purpose",
    "values": ["Value1", "Value2", "Value3", "Value4"],
    "tone": ["Professional", "Approachable", "Confident", "Clear"],
    "colors": [
      { "name": "Primary", "hex": "#HEXCOLOR" },
      { "name": "Secondary", "hex": "#HEXCOLOR" },
      { "name": "Accent", "hex": "#HEXCOLOR" },
      { "name": "Neutral", "hex": "#HEXCOLOR" }
    ],
    "typography": {
      "heading": "Font name for headings",
      "body": "Font name for body text"
    }
  }
}`;

    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      this._model,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    );

    logger.debug({ provider: this.name, rawLength: raw.length }, "Raw response from NVIDIA");
    return this.validateBlueprint(raw) as unknown as BlueprintResult;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const prompt = buildMinimalWebsitePrompt(blueprint);
    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      this._model,
      [
        { role: "system", content: "Return ONLY valid JSON matching the schema below. No markdown, no explanation." },
        { role: "user", content: prompt },
      ],
      800,
    );
    const minimal = this.validateMinimalContent(raw);
    return enrichMinimalToFullSpec(minimal, blueprint);
  }

  async generateWebsitePage(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Promise<PageHTMLResult> {
    const messages = this.buildPageGenerationPrompt(blueprint, spec, page);
    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      this._model,
      messages,
      8192,
    );

    return this.validatePageHTML(raw) as unknown as PageHTMLResult;
  }
}

function initializeProviderRegistry(): void {
  const registrations: Array<{
    id: string;
    provider: string;
    model: string;
    priority: number;
    key: string | undefined;
    createProvider: () => AIProvider;
  }> = [];

  registrations.push(
    { id: "google-1", provider: "google", model: "gemini-2.0-flash", priority: 1, key: env.GOOGLE_API_KEY_1, createProvider: () => new GoogleAIStudioProvider(env.GOOGLE_API_KEY_1!) },
    { id: "google-2", provider: "google", model: "gemini-2.0-flash", priority: 1, key: env.GOOGLE_API_KEY_2, createProvider: () => new GoogleAIStudioProvider(env.GOOGLE_API_KEY_2!) },
    { id: "google-3", provider: "google", model: "gemini-2.0-flash", priority: 1, key: env.GOOGLE_API_KEY_3, createProvider: () => new GoogleAIStudioProvider(env.GOOGLE_API_KEY_3!) },
    { id: "groq-1", provider: "groq", model: "llama-3.3-70b-versatile", priority: 2, key: env.GROQ_API_KEY_1 || env.GROQ_API_KEY, createProvider: () => new GroqProvider(env.GROQ_API_KEY_1 || env.GROQ_API_KEY) },
    { id: "groq-2", provider: "groq", model: "llama-3.3-70b-versatile", priority: 2, key: env.GROQ_API_KEY_2, createProvider: () => new GroqProvider(env.GROQ_API_KEY_2!) },
    { id: "groq-3", provider: "groq", model: "llama-3.3-70b-versatile", priority: 2, key: env.GROQ_API_KEY_3, createProvider: () => new GroqProvider(env.GROQ_API_KEY_3!) },
    { id: "nim-1", provider: "nim", model: "nvidia/nvidia-nemotron-nano-9b-v2", priority: 3, key: env.NIM_API_KEY_1, createProvider: () => new NVIDIAProvider(env.NIM_API_KEY_1!) },
    { id: "nim-2", provider: "nim", model: "nvidia/nvidia-nemotron-nano-9b-v2", priority: 3, key: env.NIM_API_KEY_2, createProvider: () => new NVIDIAProvider(env.NIM_API_KEY_2!) },
    { id: "openrouter-1", provider: "openrouter", model: "openai/gpt-4o", priority: 4, key: env.OPENROUTER_API_KEY, createProvider: () => new OpenRouterProvider(env.OPENROUTER_API_KEY!) },
  );

  for (const reg of registrations) {
    if (reg.key) {
      providerRegistry.register({
        id: reg.id,
        provider: reg.provider,
        model: reg.model,
        priority: reg.priority,
        apiKey: reg.key,
        createProvider: reg.createProvider,
      });
    }
  }
}

initializeProviderRegistry();

function getAvailableProviders(): Array<{
  id: string;
  name: string;
  create: () => AIProvider;
}> {
  const providers: Array<{
    id: string;
    name: string;
    create: () => AIProvider;
  }> = [];

  const fallbackEntries = [
    { id: "freellm", name: "FreeLLMAPI", factory: () => new FreeLLMProvider(), key: env.FREELLM_API_KEY },
  ];

  for (const fe of fallbackEntries) {
    if (fe.key) {
      providers.push({ id: fe.id, name: fe.name, create: fe.factory });
    }
  }

  const entry = providerRegistry.getNextAvailableProvider();
  if (entry) {
    providers.push({
      id: entry.id,
      name: entry.provider,
      create: entry.createProvider,
    });
  }

  return providers;
}

async function tryProvider<T>(
  providerId: string,
  provider: AIProvider,
  action: (p: AIProvider) => Promise<T>,
): Promise<{ result: T; providerName: string }> {
  const start = Date.now();

  const entry = providerRegistry.getEntry(providerId);
  const modelName = entry?.model ?? "unknown";

  logger.info(
    { provider: provider.name, providerId, model: modelName, action: action.toString().substring(0, 60) },
    "AI provider: attempting",
  );
  try {
    const result = await action(provider);
    const duration = Date.now() - start;
    logger.info(
      { provider: provider.name, providerId, model: modelName, durationMs: duration },
      "AI provider: succeeded",
    );
    providerRegistry.recordSuccess(providerId, duration);
    return { result, providerName: provider.name };
  } catch (error) {
    const duration = Date.now() - start;
    const statusCode = error instanceof AIProviderError ? error.statusCode : 0;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const stackTrace = error instanceof Error ? error.stack : undefined;
    logger.warn(
      {
        provider: provider.name, providerId, model: modelName,
        statusCode, durationMs: duration,
        error: errorMessage, stack: stackTrace,
      },
      "AI provider: failed — will attempt next provider in fallback chain",
    );
    providerRegistry.recordFailure(providerId, statusCode, duration);
    throw error;
  }
}

export function getAIProvider(): AIProvider {
  const entry = providerRegistry.getNextAvailableProvider();
  if (entry) {
    return entry.createProvider();
  }
  if (env.FREELLM_API_KEY) {
    return new FreeLLMProvider();
  }
  const errorMsg = "No AI provider configured. Set GOOGLE_API_KEY_1, GROQ_API_KEY, NIM_API_KEY_1, OPENROUTER_API_KEY, or FREELLM_API_KEY.";
  logger.error(errorMsg);
  throw new Error("No AI provider configured");
}

async function withFailover<T>(
  action: (p: AIProvider) => Promise<T>,
  context: string,
): Promise<T> {
  const errors: Array<{ provider: string; model: string; error: string; statusCode: number }> = [];
  const availableCount = providerRegistry.getEntryCount();
  const hasFreeLLM = !!env.FREELLM_API_KEY;
  const totalTimeout = env.AI_FAILOVER_TOTAL_TIMEOUT_MS;
  const overallStart = Date.now();

  logger.info(
    { availableProviders: availableCount, hasFreeLLM, context, totalTimeout },
    "AI provider: starting fallback chain",
  );

  function elapsed() { return Date.now() - overallStart; }
  function timeRemaining() { return Math.max(0, totalTimeout - elapsed()); }

  if (hasFreeLLM) {
    const provider = new FreeLLMProvider();
    logger.info({ provider: "freellm", model: "gpt-4o-mini", apiKeyExists: !!env.FREELLM_API_KEY }, "[AI] attempting provider");
    try {
      logger.info({ provider: "FreeLLMAPI", model: "gpt-4o-mini" }, "AI provider: attempting FreeLLMAPI");
      const { result } = await tryProvider("freellm", provider, action);
      logger.info({ provider: "FreeLLMAPI", model: "gpt-4o-mini" }, "[Blueprint] FreeLLMAPI succeeded");
      return result;
    } catch (error) {
      logger.error({ provider: "freellm", error, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, "[AI] provider failed");
      const message = error instanceof AIProviderError
        ? `[${error.provider}] status=${error.statusCode} ${error.message}`
        : error instanceof ZodError
          ? `Validation failed: ${error.message}`
          : error instanceof Error
            ? error.message
            : "Unknown error";
      const statusCode = error instanceof AIProviderError ? error.statusCode : 0;
      errors.push({ provider: "FreeLLMAPI", model: "gpt-4o-mini", error: message, statusCode });
      logger.warn({ provider: "FreeLLMAPI", error: message }, "AI provider: FreeLLMAPI failed, trying next in chain");
    }
  }

  let attemptCount = 0;
  const maxAttempts = availableCount + 1;

  while (attemptCount < maxAttempts) {
    if (timeRemaining() <= 0) {
      logger.warn({ elapsedMs: elapsed(), totalTimeout }, "AI provider: total timeout reached, skipping remaining providers");
      break;
    }

    const entry = providerRegistry.getNextAvailableProvider();
    if (!entry) break;

    attemptCount++;
    const provider = entry.createProvider();
    logger.info({ provider: entry.id, model: entry.model, apiKeyExists: !!entry.apiKey }, "[AI] attempting provider");
    try {
      logger.info({ provider: entry.provider, model: entry.model, id: entry.id, attempt: attemptCount, total: availableCount }, "AI provider: attempting");
      const { result } = await tryProvider(entry.id, provider, action);
      logger.info({ provider: entry.provider, model: entry.model, id: entry.id, attempt: attemptCount }, "[Blueprint] Provider succeeded");
      return result;
    } catch (error) {
      logger.error({ provider: entry.id, error, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, "[AI] provider failed");
      const message = error instanceof AIProviderError
        ? `[${error.provider}] status=${error.statusCode} ${error.message}`
        : error instanceof ZodError
          ? `Validation failed: ${error.message}`
          : error instanceof Error
            ? error.message
            : "Unknown error";
      const statusCode = error instanceof AIProviderError ? error.statusCode : 0;
      errors.push({ provider: entry.id, model: entry.model, error: message, statusCode });

      const remaining = availableCount - attemptCount + (hasFreeLLM ? 0 : 0);
      logger.warn(
        { provider: entry.provider, model: entry.model, id: entry.id, remainingProviders: remaining, error: message, elapsedMs: elapsed() },
        "AI provider: failed — trying next",
      );
    }
  }

  const detail = errors.map((e) => `${e.provider} (${e.model}): [${e.statusCode}] ${e.error}`).join(" | ");
  const prefix = context ? `${context}: ` : "";
  const fullError = `${prefix}All AI providers failed after ${elapsed()}ms (tried ${errors.length} providers): ${detail}`;
  logger.error({ errors: errors.map(e => ({ provider: e.provider, model: e.model, statusCode: e.statusCode, error: e.error })) }, fullError);
  throw new Error(fullError);
}

function buildFallbackBlueprint(name: string, description?: string): BlueprintResult {
  const industry = "Technology";
  const featureList: string[] = [];

  return {
    name,
    description: description || `${name} - A modern technology startup.`,
    industry,
    targetAudience: "Early adopters and professionals seeking innovative solutions",
    problemStatement: `Customers need better solutions in this space, and existing options don't fully address their needs.`,
    solution: `${name} provides a modern, efficient solution that leverages technology to solve these challenges.`,
    keyFeatures: featureList,
    techStack: ["Modern web technologies", "Cloud infrastructure", "API-first architecture"],
    monetization: "Subscription-based pricing with tiered plans",
    competitorAnalysis: ["Traditional incumbents", "Emerging startups in the space"],
    roadmap: ["Launch MVP", "Gather user feedback", "Scale infrastructure", "Expand feature set"],
  };
}

export async function generateBlueprintWithFallback(
  prompt: string,
  startupName?: string,
  startupDescription?: string,
): Promise<BlueprintResult> {
  const availableCount = providerRegistry.getEntryCount();
  const hasFreeLLM = !!env.FREELLM_API_KEY;
  logger.info(
    { promptLength: prompt.length, availableProviders: availableCount, hasFreeLLM },
    "[Blueprint] generateBlueprintWithFallback: starting",
  );
  if (availableCount === 0 && !hasFreeLLM) {
    logger.warn(
      { availableProviders: 0, hasFreeLLM: false },
      "[Blueprint] No AI provider configured, building fallback blueprint",
    );
    return buildFallbackBlueprint(startupName || prompt, startupDescription);
  }
  const totalStart = Date.now();
  try {
    const result = await withFailover((p) => p.generateBlueprint(prompt), "generateBlueprint");
    const totalDuration = Date.now() - totalStart;
    logger.info(
      { success: true, totalDurationMs: totalDuration, name: result.name, industry: result.industry },
      "[Blueprint] generateBlueprintWithFallback: succeeded",
    );
    return result;
  } catch (error) {
    const totalDuration = Date.now() - totalStart;
    logger.warn(
      { success: false, totalDurationMs: totalDuration, error: error instanceof Error ? error.message : String(error) },
      "[Blueprint] generateBlueprintWithFallback: all providers failed, building fallback blueprint",
    );
    return buildFallbackBlueprint(startupName || prompt, startupDescription);
  }
}

function buildFallbackWebsiteSpec(blueprint: BlueprintResult): WebsiteSpecResult {
  const features = (blueprint.keyFeatures || []).slice(0, 6).map((f) =>
    typeof f === "string" ? { title: f, description: "" } : { title: String(f), description: "" },
  );

  return {
    pages: [
      {
        name: "Home",
        slug: "/",
        sections: [
          {
            type: "hero",
            order: 1,
            content: {
              headline: blueprint.name,
              subheadline: blueprint.description,
              ctaText: "Get Started",
              ctaSecondary: "Learn More",
            },
          },
          {
            type: "features",
            order: 2,
            content: {
              title: "Features",
              subtitle: `${blueprint.name} offers powerful features to help you succeed`,
              items: features,
            },
          },
          {
            type: "pricing",
            order: 3,
            content: {
              headline: "Simple Pricing",
              subtitle: blueprint.monetization || "Start free, upgrade as you grow",
              plans: [],
            },
          },
          {
            type: "cta",
            order: 4,
            content: {
              headline: `Ready to start with ${blueprint.name}?`,
              subheadline: blueprint.description,
              ctaText: "Get Started",
            },
          },
        ],
      },
    ],
    theme: {
      primaryColor: "#2563EB",
      secondaryColor: "#7C3AED",
      fontFamily: "Inter",
      borderRadius: "12px",
    },
    components: [
      { name: "Navbar", type: "navigation", props: {} },
      { name: "Footer", type: "footer", props: {} },
    ],
  };
}

export async function generateWebsiteSpecWithFallback(
  blueprint: BlueprintResult,
): Promise<WebsiteSpecResult> {
  if (providerRegistry.getEntryCount() === 0 && !env.FREELLM_API_KEY) {
    throw new Error("No AI provider configured.");
  }
  try {
    return await withFailover((p) => p.generateWebsiteSpec(blueprint), "");
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "[WEBSITE] all providers failed, building fallback spec from blueprint",
    );
    return buildFallbackWebsiteSpec(blueprint);
  }
}

export async function generateWebsitePageWithFallback(
  blueprint: BlueprintResult,
  spec: WebsiteSpecResult,
  page: PageSpec,
): Promise<PageHTMLResult> {
  if (providerRegistry.getEntryCount() === 0 && !env.FREELLM_API_KEY) {
    throw new Error("No AI provider configured.");
  }
  return withFailover(
    (p) => p.generateWebsitePage(blueprint, spec, page),
    `page "${page.name}"`,
  );
}
