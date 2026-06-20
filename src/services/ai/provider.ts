import {
  AIProvider,
  BlueprintResult,
  WebsiteSpecResult,
  PageSpec,
  PageHTMLResult,
} from "../../types/ai.js";
import { env } from "../../lib/env.js";
import { logger } from "../../lib/logger.js";
import {
  BlueprintResultSchema,
  WebsiteSpecResultSchema,
  PageHTMLResultSchema,
  ValidatedBlueprint,
  ValidatedWebsiteSpec,
  ValidatedPageHTML,
  normalizeBlueprint,
} from "./validation.js";
import { ZodError } from "zod";

const TIMEOUT_MS = env.AI_TIMEOUT_MS;

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
          await new Promise((resolve) => setTimeout(resolve, delay));
          throw new AIProviderError(this.name, 429, `Rate limited (retry after ${delay}ms)`);
        }
        const errorBody = await response.text();
        throw new AIProviderError(this.name, response.status, errorBody);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new AIProviderError(this.name, 0, "Empty response from AI provider");
      }
      return content;
    } catch (error) {
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
      throw new AIProviderError(this.name, 0, "Empty response after cleaning");
    }
    return JSON.parse(cleaned) as T;
  }

  protected validateBlueprint(raw: string): ValidatedBlueprint {
    logger.info({ rawLength: raw.length, rawPreview: raw.substring(0, 200) }, "Raw AI response for blueprint");
    const parsed = this.parseJSONResponse<Record<string, unknown>>(raw);
    logger.info({ parsedKeys: Object.keys(parsed) }, "Parsed blueprint object");
    const normalized = normalizeBlueprint(parsed);
    const validated = BlueprintResultSchema.parse(normalized);
    console.log("[BP-DATA] validated blueprint", JSON.stringify(validated, null, 2));
    logger.info({ validatedKeys: Object.keys(validated), validatedName: validated.name }, "Validated blueprint");
    return validated;
  }

  protected validateWebsiteSpec(raw: string): ValidatedWebsiteSpec {
    const parsed = this.parseJSONResponse<Record<string, unknown>>(raw);
    return WebsiteSpecResultSchema.parse(parsed);
  }

  protected validatePageHTML(raw: string): ValidatedPageHTML {
    const parsed = this.parseJSONResponse<Record<string, unknown>>(raw);
    return PageHTMLResultSchema.parse(parsed);
  }

  protected buildPageGenerationPrompt(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Array<{ role: string; content: string }> {
    const systemPrompt = `You are an expert web developer. Generate a complete, production-ready HTML page for a startup website.

CRITICAL: Do NOT include any text, explanation, or markdown before or after the JSON. Return ONLY the raw JSON object — nothing else.
The JSON must have exactly three fields: "slug", "title", and "html".

Requirements for the HTML:
- The HTML must be a full document: <!DOCTYPE html>, <html>, <head>, <body>
- Use semantic HTML5 (header, nav, main, section, footer)
- Must be fully responsive (mobile-first with media queries)
- All CSS must be inline in a <style> tag in <head>
- Include the Inter font from Google Fonts
- All content must be real, compelling marketing copy — no placeholder text
- Include proper meta tags (charset, viewport, description)
- The page must be self-contained (no external CSS/JS except Google Fonts)
- Use CSS Grid or Flexbox for layout
- Include hover effects on interactive elements
- Include smooth scroll behavior
- Do NOT use markdown fences in your response
- Do NOT include TODO markers or placeholder text

Theme:
- Primary color: ${spec.theme.primaryColor}
- Secondary color: ${spec.theme.secondaryColor}
- Font family: ${spec.theme.fontFamily}
- Border radius: ${spec.theme.borderRadius}

Startup context:
- Name: ${blueprint.name}
- Industry: ${blueprint.industry}
- Description: ${blueprint.description}
- Target audience: ${blueprint.targetAudience}
- Key features: ${blueprint.keyFeatures.join(", ")}
- Solution: ${blueprint.solution}

Page to generate:
- Name: ${page.name}
- Slug: ${page.slug}
- Sections (in order): ${page.sections.map((s) => s.type).join(", ")}
- Section content: ${JSON.stringify(page.sections)}

Return ONLY a JSON object with this exact structure:
{
  "slug": "${page.slug}",
  "title": "${page.name}",
  "html": "<!DOCTYPE html><html>...</html>"
}`;

    return [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Generate the "${page.name}" page for ${blueprint.name}. Return ONLY the JSON object with the html field.`,
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
  "roadmap": ["milestone1", "milestone2"]
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

    logger.info({ provider: this.name, rawLength: raw.length, rawPreview: raw.substring(0, 200) }, "Raw response from FreeLLM");
    const validated = this.validateBlueprint(raw) as unknown as BlueprintResult;
    console.log("[BP-DATA] FreeLLM validated keys", Object.keys(validated));
    console.log("[BP-DATA] FreeLLM validated", JSON.stringify(validated, null, 2));
    return validated;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const systemPrompt = `You are a website specification generator. Given a startup blueprint, generate a website spec.
Do NOT include any text, explanation, or markdown before or after the JSON. Return ONLY the raw JSON object — nothing else.
Return ONLY valid JSON with this exact structure:
{
  "pages": [
    {
      "name": "Home",
      "slug": "/",
      "sections": [
        { "type": "hero", "order": 1, "content": { "headline": "...", "subheadline": "...", "ctaText": "..." } },
        { "type": "features", "order": 2, "content": { "items": [...] } }
      ]
    }
  ],
  "theme": {
    "primaryColor": "#000000",
    "secondaryColor": "#ffffff",
    "fontFamily": "Inter",
    "borderRadius": "8px"
  },
  "components": [
    { "name": "Navbar", "type": "navigation", "props": {} }
  ]
}`;

    const raw = await this.callAPI(
      this.endpoint,
      env.FREELLM_API_KEY!,
      "gpt-4o-mini",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(blueprint) },
      ],
    );

    return this.validateWebsiteSpec(raw) as unknown as WebsiteSpecResult;
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
  "roadmap": [...]
}`;

    const raw = await this.callAPI(
      this.endpoint,
      env.GROQ_API_KEY!,
      "llama-3.3-70b-versatile",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    );

    logger.info({ provider: this.name, rawLength: raw.length, rawPreview: raw.substring(0, 200) }, "Raw response from Groq");
    const validated = this.validateBlueprint(raw) as unknown as BlueprintResult;
    console.log("[BP-DATA] Groq validated keys", Object.keys(validated));
    console.log("[BP-DATA] Groq validated", JSON.stringify(validated, null, 2));
    return validated;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const systemPrompt = `You are a website specification generator. Given a startup blueprint, generate a website spec.
Do NOT include any text, explanation, or markdown before or after the JSON. Return ONLY the raw JSON object — nothing else.
Generate pages with diverse section types: hero, features, pricing, testimonials, faq, cta, stats, team, contact — mix them based on the startup's industry.
Return ONLY valid JSON with this exact structure:
{
  "pages": [
    {
      "name": "Home",
      "slug": "/",
      "sections": [
        { "type": "hero", "order": 1, "content": { "headline": "...", "subheadline": "...", "ctaText": "..." } },
        { "type": "features", "order": 2, "content": { "items": [...] } }
      ]
    }
  ],
  "theme": {
    "primaryColor": "#hex",
    "secondaryColor": "#hex",
    "fontFamily": "Font Name",
    "borderRadius": "Npx"
  },
  "components": [
    { "name": "Navbar", "type": "navigation", "props": {} }
  ]
}`;

    const raw = await this.callAPI(
      this.endpoint,
      env.GROQ_API_KEY!,
      "llama-3.3-70b-versatile",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(blueprint) },
      ],
    );

    return this.validateWebsiteSpec(raw) as unknown as WebsiteSpecResult;
  }

  async generateWebsitePage(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Promise<PageHTMLResult> {
    const messages = this.buildPageGenerationPrompt(blueprint, spec, page);
    const raw = await this.callAPI(
      this.endpoint,
      env.GROQ_API_KEY!,
      "llama-3.3-70b-versatile",
      messages,
      8192,
    );

    return this.validatePageHTML(raw) as unknown as PageHTMLResult;
  }
}

export class OpenRouterProvider extends BaseAIProvider {
  name = "OpenRouter";

  private get endpoint(): string {
    return "https://openrouter.ai/api/v1/chat/completions";
  }

  async generateBlueprint(prompt: string): Promise<BlueprintResult> {
    const raw = await this.callAPI(
      this.endpoint,
      env.OPENROUTER_API_KEY!,
      "openai/gpt-4o",
      [
        { role: "system", content: "You are a startup blueprint generator. Do NOT include any text before or after the JSON. Return ONLY the raw JSON object with fields: name, description, industry, targetAudience, problemStatement, solution, keyFeatures, techStack, monetization, competitorAnalysis, roadmap." },
        { role: "user", content: prompt },
      ],
    );

    logger.info({ provider: this.name, rawLength: raw.length, rawPreview: raw.substring(0, 200) }, "Raw response from OpenRouter");
    const validated = this.validateBlueprint(raw) as unknown as BlueprintResult;
    console.log("[BP-DATA] OpenRouter validated keys", Object.keys(validated));
    console.log("[BP-DATA] OpenRouter validated", JSON.stringify(validated, null, 2));
    return validated;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const raw = await this.callAPI(
      this.endpoint,
      env.OPENROUTER_API_KEY!,
      "openai/gpt-4o",
      [
        { role: "system", content: "You are a website specification generator. Do NOT include any text before or after the JSON. Return ONLY the raw JSON object with fields: pages (array with name/slug/sections), theme (primaryColor/secondaryColor/fontFamily/borderRadius), components." },
        { role: "user", content: JSON.stringify(blueprint) },
      ],
    );

    return this.validateWebsiteSpec(raw) as unknown as WebsiteSpecResult;
  }

  async generateWebsitePage(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Promise<PageHTMLResult> {
    const messages = this.buildPageGenerationPrompt(blueprint, spec, page);
    const raw = await this.callAPI(
      this.endpoint,
      env.OPENROUTER_API_KEY!,
      "openai/gpt-4o",
      messages,
      8192,
    );

    return this.validatePageHTML(raw) as unknown as PageHTMLResult;
  }
}

function getAvailableProviders(): Array<{ name: string; create: () => AIProvider }> {
  const providers: Array<{ name: string; create: () => AIProvider }> = [];

  if (env.FREELLM_API_KEY) {
    providers.push({ name: "FreeLLMAPI", create: () => new FreeLLMProvider() });
  }
  if (env.GROQ_API_KEY) {
    providers.push({ name: "Groq", create: () => new GroqProvider() });
  }
  if (env.OPENROUTER_API_KEY) {
    providers.push({ name: "OpenRouter", create: () => new OpenRouterProvider() });
  }

  return providers;
}

async function tryProvider<T>(
  provider: AIProvider,
  action: (p: AIProvider) => Promise<T>,
): Promise<{ result: T; providerName: string }> {
  const start = Date.now();
  logger.info({ provider: provider.name }, "Attempting AI provider");
  try {
    const result = await action(provider);
    const duration = Date.now() - start;
    logger.info({ provider: provider.name, durationMs: duration }, "AI provider succeeded");
    return { result, providerName: provider.name };
  } catch (error) {
    const duration = Date.now() - start;
    logger.warn({ provider: provider.name, durationMs: duration, error }, "AI provider failed");
    throw error;
  }
}

export function getAIProvider(): AIProvider {
  const available = getAvailableProviders();
  if (available.length === 0) {
    throw new Error("No AI provider configured. Set FREELLM_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.");
  }
  return available[0].create();
}

export async function generateBlueprintWithFallback(prompt: string): Promise<BlueprintResult> {
  const providers = getAvailableProviders();
  if (providers.length === 0) {
    throw new Error("No AI provider configured.");
  }

  const errors: Array<{ provider: string; error: string }> = [];

  for (const entry of providers) {
    const provider = entry.create();
    try {
      const { result } = await tryProvider(provider, (p) => p.generateBlueprint(prompt));
      return result;
    } catch (error) {
      const message =
        error instanceof AIProviderError
          ? `[${error.provider}] status=${error.statusCode} ${error.message}`
          : error instanceof ZodError
            ? `Validation failed: ${error.message}`
            : error instanceof Error
              ? error.message
              : "Unknown error";
      errors.push({ provider: entry.name, error: message });
    }
  }

  const detail = errors.map((e) => `${e.provider}: ${e.error}`).join(" | ");
  throw new Error(`All AI providers failed: ${detail}`);
}

export async function generateWebsiteSpecWithFallback(
  blueprint: BlueprintResult,
): Promise<WebsiteSpecResult> {
  const providers = getAvailableProviders();
  if (providers.length === 0) {
    throw new Error("No AI provider configured.");
  }

  const errors: Array<{ provider: string; error: string }> = [];

  for (const entry of providers) {
    const provider = entry.create();
    try {
      const { result } = await tryProvider(provider, (p) => p.generateWebsiteSpec(blueprint));
      return result;
    } catch (error) {
      const message =
        error instanceof AIProviderError
          ? `[${error.provider}] status=${error.statusCode} ${error.message}`
          : error instanceof ZodError
            ? `Validation failed: ${error.message}`
            : error instanceof Error
              ? error.message
              : "Unknown error";
      errors.push({ provider: entry.name, error: message });
    }
  }

  const detail = errors.map((e) => `${e.provider}: ${e.error}`).join(" | ");
  throw new Error(`All AI providers failed: ${detail}`);
}

export async function generateWebsitePageWithFallback(
  blueprint: BlueprintResult,
  spec: WebsiteSpecResult,
  page: PageSpec,
): Promise<PageHTMLResult> {
  const providers = getAvailableProviders();
  if (providers.length === 0) {
    throw new Error("No AI provider configured.");
  }

  const errors: Array<{ provider: string; error: string }> = [];

  for (const entry of providers) {
    const provider = entry.create();
    try {
      const { result } = await tryProvider(provider, (p) =>
        p.generateWebsitePage(blueprint, spec, page),
      );
      return result;
    } catch (error) {
      const message =
        error instanceof AIProviderError
          ? `[${error.provider}] status=${error.statusCode} ${error.message}`
          : error instanceof ZodError
            ? `Validation failed: ${error.message}`
            : error instanceof Error
              ? error.message
              : "Unknown error";
      errors.push({ provider: entry.name, error: message });
    }
  }

  const detail = errors.map((e) => `${e.provider}: ${e.error}`).join(" | ");
  throw new Error(`All AI providers failed for page "${page.name}": ${detail}`);
}
