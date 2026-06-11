import { AIProvider, BlueprintResult, WebsiteSpecResult } from "../../types/ai.js";
import { env } from "../../lib/env.js";
import { logger } from "../../lib/logger.js";
import { BlueprintResultSchema, WebsiteSpecResultSchema, ValidatedBlueprint, ValidatedWebsiteSpec } from "./validation.js";
import { ZodError } from "zod";

const TIMEOUT_MS = env.AI_TIMEOUT_MS;

export abstract class BaseAIProvider implements AIProvider {
  abstract name: string;

  abstract generateBlueprint(prompt: string): Promise<BlueprintResult>;
  abstract generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult>;

  protected async callAPI(
    endpoint: string,
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
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
          temperature: 0.7,
          max_tokens: 4096,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new AIProviderError(this.name, 429, "Rate limited");
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
    } finally {
      clearTimeout(timeout);
    }
  }

  protected parseJSONResponse<T>(raw: string): T {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").replace(/^```|```$/g, "").trim();
    if (!cleaned) {
      throw new AIProviderError(this.name, 0, "Empty response after cleaning");
    }
    return JSON.parse(cleaned) as T;
  }

  protected validateBlueprint(raw: string): ValidatedBlueprint {
    const parsed = this.parseJSONResponse<Record<string, unknown>>(raw);
    return BlueprintResultSchema.parse(parsed);
  }

  protected validateWebsiteSpec(raw: string): ValidatedWebsiteSpec {
    const parsed = this.parseJSONResponse<Record<string, unknown>>(raw);
    return WebsiteSpecResultSchema.parse(parsed);
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

    return this.validateBlueprint(raw) as unknown as BlueprintResult;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const systemPrompt = `You are a website specification generator. Given a startup blueprint, generate a website spec.
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
}

export class GroqProvider extends BaseAIProvider {
  name = "Groq";

  private get endpoint(): string {
    return "https://api.groq.com/openai/v1/chat/completions";
  }

  async generateBlueprint(prompt: string): Promise<BlueprintResult> {
    const systemPrompt = `Generate a startup blueprint as JSON. Use this exact structure:
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

    return this.validateBlueprint(raw) as unknown as BlueprintResult;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const raw = await this.callAPI(
      this.endpoint,
      env.GROQ_API_KEY!,
      "llama-3.3-70b-versatile",
      [
        { role: "system", content: "Generate a website spec as JSON from the given blueprint." },
        { role: "user", content: JSON.stringify(blueprint) },
      ],
    );

    return this.validateWebsiteSpec(raw) as unknown as WebsiteSpecResult;
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
        { role: "system", content: "Generate a startup blueprint as JSON." },
        { role: "user", content: prompt },
      ],
    );

    return this.validateBlueprint(raw) as unknown as BlueprintResult;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const raw = await this.callAPI(
      this.endpoint,
      env.OPENROUTER_API_KEY!,
      "openai/gpt-4o",
      [
        { role: "system", content: "Generate a website spec as JSON from the given blueprint." },
        { role: "user", content: JSON.stringify(blueprint) },
      ],
    );

    return this.validateWebsiteSpec(raw) as unknown as WebsiteSpecResult;
  }
}

interface ProviderFactory {
  new(): AIProvider & { name: string };
  name: string;
}

type ProviderConstructor = new () => AIProvider;

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
      const message = error instanceof AIProviderError
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

export async function generateWebsiteSpecWithFallback(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
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
      const message = error instanceof AIProviderError
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