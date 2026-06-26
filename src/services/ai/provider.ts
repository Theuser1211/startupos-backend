import {
  AIProvider,
  BlueprintResult,
  WebsiteSpecResult,
  PageSpec,
  PageHTMLResult,
  ThemeSpec,
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
  extractJSON,
} from "./validation.js";
import { ZodError } from "zod";
import { providerRegistry } from "./provider-registry.js";

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
      logger.info({ provider: this.name, url: endpoint, model }, "[AI] sending request");
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

      logger.info({ provider: this.name, status: response.status }, "[AI] response");

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
      throw new AIProviderError(this.name, 0, "Empty response after cleaning");
    }
    return JSON.parse(cleaned) as T;
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

    logger.debug({ provider: this.name, rawLength: raw.length }, "Raw response from FreeLLM");
    const validated = this.validateBlueprint(raw) as unknown as BlueprintResult;
    return validated;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const industry = blueprint.industry || "technology";
    const systemPrompt = `You are a senior startup copywriter and website strategist. Given a startup blueprint, generate a premium SaaS website specification.

CRITICAL: Return ONLY valid JSON. No markdown, no explanation. No code fences.

CONSTRAINTS — NEVER fabricate:
- NO fake testimonials, team members, statistics, customer logos, reviews, or company claims
- NO fake addresses, phone numbers, email addresses, or social media handles
- NO fake legal information (privacy policy terms, etc.)
- Only include sections that can be populated truthfully from the blueprint data
- Skip testimonials, team, stats, logo-cloud sections entirely — they require fabricated data
- If you lack real data for a field, leave it empty or omit the section

REQUIRED PAGE: Home ("/") with these sections in this order:

1. hero — content includes:
   - headline: A specific, benefit-driven headline (e.g. "Ship API integrations 10x faster" not "Revolutionary Integration Platform")
   - subheadline: Clear value proposition expanding on the headline
   - ctaText: Action-oriented primary CTA (e.g. "Start Building Free")
   - ctaSecondary: Lower-friction secondary CTA (e.g. "See How It Works")

2. problem (or "pain") — content includes:
   - headline: Framing of the problem (e.g. "Building integrations is still painfully manual")
   - description: Specific pain description from the blueprint's problemStatement
   - painPoints: Array of 3-4 specific pain points derived from the blueprint

3. solution (or "benefits") — content includes:
   - headline: How the product solves the problem
   - description: Solution from blueprint.solution
   - benefits: Array of 3-4 specific benefits from the solution

4. features — content includes:
   - title: Section heading (e.g. "Everything you need to ship integrations")
   - subtitle: Optional supporting text
   - items: Array of feature objects, each with "title" and "description" (NOT plain strings). Derive from blueprint.keyFeatures. Make descriptions concrete and specific.

5. pricing — content includes:
   - headline: "Simple, transparent pricing" (or similar)
   - subtitle: Description of the real monetization model from blueprint.monetization
   - plans: Array of 2-3 plan objects with:
     - name: Plan name (e.g. "Starter", "Pro", "Enterprise")
     - price: Dollar amount string (e.g. "$29")
     - period: "month" (omit for enterprise)
     - description: One-line description
     - features: Array of 4-6 specific features
     - highlighted: true for the recommended tier (exactly 1 plan)

6. faq — content includes:
   - subtitle: Optional supporting text
   - items: Array of 3-5 objects with "question" and "answer". Write real questions a potential customer would ask about this specific product category. Not generic industry questions.

7. cta — content includes:
   - headline: A compelling final CTA headline referencing the company name
   - subheadline: Brief supporting message
   - ctaText: Final action button text (e.g. "Get Started Free")

OPTIONAL: social-proof — content includes:
   - headline: "Trusted by teams building ..."
   - items: Array of 3-5 placeholder company names (generic like "Company A", "Startup X") — these are clearly placeholders, not real logos

OPTIONAL: 1 additional page (About, How It Works, or Features deep-dive):
- Must derive ALL content from blueprint data
- Do not create pages with fabricated or empty content

COPYWRITING RULES:
- Headlines must be specific to what this startup does. Compare:
  BAD: "Revolutionary Platform for Modern Teams"
  GOOD: "Automate your customer data pipelines in minutes"
- Use concrete language from blueprint.keyFeatures and blueprint.solution
- Focus on customer outcomes, not product features
- Use the startup's target audience to inform tone and messaging
- Avoid: "revolutionary", "game-changing", "best-in-class", "cutting-edge", "next-generation", "industry-leading"
- Every word should pass the "so what?" test — does it tell the user why they should care?

COLOR GUIDANCE for ${industry}:

| Industry | Primary | Secondary | Why |
|---|---|---|---|
| Fintech/Finance | #0F766E | #14B8A6 | Trustworthy teal |
| Healthcare | #059669 | #10B981 | Calming green |
| DevTools/SaaS | #2563EB | #7C3AED | Bold blue-purple |
| AI/ML | #7C3AED | #2563EB | Creative purple-blue |
| E-commerce | #E11D48 | #BE185D | Energetic red |
| Education | #7C3AED | #8B5CF6 | Approachable purple |
| Security | #1E293B | #475569 | Strong dark |
| Enterprise | #4F46E5 | #6366F1 | Trustworthy indigo |
| Creative | #EC4899 | #F43F5E | Vibrant pink |
| Other | #2563EB | #7C3AED | Versatile blue |

Font: "Inter", borderRadius: "12px"

Return ONLY valid JSON with this exact structure:
{
  "pages": [
    {
      "name": "Home",
      "slug": "/",
      "sections": [
        { "type": "hero", "order": 1, "content": { "headline": "headline here", "subheadline": "subheadline here", "ctaText": "Primary CTA", "ctaSecondary": "Secondary CTA" } },
        { "type": "problem", "order": 2, "content": { "headline": "problem headline", "description": "problem description", "painPoints": ["pain 1", "pain 2", "pain 3"] } },
        { "type": "solution", "order": 3, "content": { "headline": "solution headline", "description": "solution description", "benefits": ["benefit 1", "benefit 2", "benefit 3"] } },
        { "type": "features", "order": 4, "content": { "title": "Features heading", "subtitle": "supporting text", "items": [{ "title": "Feature", "description": "Description" }] } },
        { "type": "pricing", "order": 5, "content": { "headline": "Pricing heading", "subtitle": "monetization description", "plans": [{ "name": "Starter", "price": "$0", "period": "month", "description": "desc", "features": ["f1", "f2"], "highlighted": false }] } },
        { "type": "faq", "order": 6, "content": { "subtitle": "", "items": [{ "question": "Q?", "answer": "A!" }] } },
        { "type": "cta", "order": 7, "content": { "headline": "CTA headline", "subheadline": "CTA subheadline", "ctaText": "Get Started" } }
      ]
    }
  ],
  "theme": {
    "primaryColor": "#2563EB",
    "secondaryColor": "#7C3AED",
    "fontFamily": "Inter",
    "borderRadius": "12px"
  },
  "components": [
    { "name": "Navbar", "type": "navigation", "props": {} },
    { "name": "Footer", "type": "footer", "props": {} }
  ]
}

REMEMBER: Use the ACTUAL blueprint data. Never fabricate testimonials, team members, statistics, or company claims. Write specific, customer-focused copy.`;

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
  "roadmap": [...]
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
    const industry = blueprint.industry || "technology";
    const systemPrompt = `You are a senior startup copywriter and website strategist. Given a startup blueprint, generate a premium SaaS website specification.

CRITICAL: Return ONLY valid JSON. No markdown, no explanation. No code fences.

CONSTRAINTS — NEVER fabricate:
- NO fake testimonials, team members, statistics, customer logos, reviews, or company claims
- NO fake addresses, phone numbers, email addresses, or social media handles
- Skip testimonials, team, stats, logo-cloud sections entirely
- Only include sections truthfully derivable from the blueprint data

REQUIRED HOME PAGE sections in order:

1. hero — content: headline (benefit-driven, specific, e.g. "Ship API integrations 10x faster"), subheadline, ctaText, ctaSecondary

2. problem — content: headline, description (from problemStatement), painPoints: string[] (3-4 items)

3. solution — content: headline, description (from solution), benefits: string[] (3-4 items)

4. features — content: title, subtitle, items: Array of {title: string, description: string} (NOT plain strings). Derive from keyFeatures with concrete descriptions.

5. pricing — content: headline, subtitle (from monetization), plans: Array of {name, price, period, description, features: string[], highlighted: boolean}

6. faq — content: subtitle, items: Array of {question, answer} (3-5 items, real customer questions about this product category)

7. cta — content: headline (includes company name), subheadline, ctaText

OPTIONAL: social-proof — content: headline, items: string[] (generic placeholder company names)

COPYWRITING RULES:
- BAD: "Revolutionary Platform for Modern Teams"  GOOD: "Automate your customer data pipelines in minutes"
- Use concrete language from blueprint.keyFeatures and blueprint.solution
- Focus on customer outcomes. Avoid: "revolutionary", "game-changing", "best-in-class", "cutting-edge"
- Every word should pass the "so what?" test

COLORS: Use industry-appropriate colors. Font: "Inter", borderRadius: "12px"
- ${industry}: Primary #2563EB, Secondary #7C3AED (or industry-specific alternatives)

Return ONLY valid JSON with the exact structure shown. Use the ACTUAL blueprint data.`;

    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
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
  "roadmap": [...]
}`;

    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "openai/gpt-4o",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      1024,
    );

    logger.debug({ provider: this.name, rawLength: raw.length }, "Raw response from OpenRouter");
    const validated = this.validateBlueprint(raw) as unknown as BlueprintResult;
    return validated;
  }

  async generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult> {
    const industry = blueprint.industry || "technology";
    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "openai/gpt-4o",
      [
        { role: "system", content: `You are a senior startup copywriter and website strategist. Given a startup blueprint, generate a premium SaaS website specification. CRITICAL: Return ONLY valid JSON. NEVER fabricate testimonials, team members, stats, logos, addresses, phone numbers, or company claims. Only include sections truthfully derivable from the blueprint data.

REQUIRED Home page sections: hero (headline=benefit-driven specific headline, subheadline, ctaText, ctaSecondary), problem (headline, description, painPoints string[]), solution (headline, description, benefits string[]), features (title, subtitle, items=[{title, description}]), pricing (headline, subtitle, plans=[{name,price,period,description,features,highlighted}]), faq (subtitle, items=[{question,answer}]), cta (headline, subheadline, ctaText). Optional: social-proof (headline, items string[]).

COPYWRITING: Specific customer-focused copy. BAD: "Revolutionary platform" GOOD: "Automate X in minutes". Use blueprint data. Avoid revolutionary/game-changing/best-in-class. Font: Inter, borderRadius: 12px. Industry: ${industry}. Return ONLY valid JSON with pages array, theme (primaryColor, secondaryColor), and components array.` },
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
  "roadmap": [...]
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
    const industry = blueprint.industry || "technology";
    const systemPrompt = `You are a senior startup copywriter and website strategist. Given a startup blueprint, generate a premium SaaS website specification.
CRITICAL: Return ONLY valid JSON. No markdown, no explanation. No code fences.
NEVER fabricate testimonials, team members, stats, addresses, or company claims.
Only include sections truthfully derivable from the blueprint data.
REQUIRED Home page sections in order:
1. hero - content: headline (benefit-driven, specific), subheadline, ctaText, ctaSecondary
2. problem - content: headline, description, painPoints string[]
3. solution - content: headline, description, benefits string[]
4. features - content: title, subtitle, items: Array of {title, description}
5. pricing - content: headline, subtitle, plans: Array of {name, price, period, description, features, highlighted}
6. faq - content: subtitle, items: Array of {question, answer}
7. cta - content: headline, subheadline, ctaText
COPYWRITING: Specific customer-focused copy. Use blueprint data. Font: Inter, borderRadius: 12px. Industry: ${industry}.
Return ONLY valid JSON with pages array, theme (primaryColor, secondaryColor), and components array.`;

    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      "gemini-2.0-flash",
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
  "roadmap": [...]
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
    const industry = blueprint.industry || "technology";
    const systemPrompt = `You are a senior startup copywriter and website strategist. Given a startup blueprint, generate a premium SaaS website specification.
CRITICAL: Return ONLY valid JSON. No markdown, no explanation. No code fences.
NEVER fabricate testimonials, team members, stats, addresses, or company claims.
Only include sections truthfully derivable from the blueprint data.
REQUIRED Home page sections in order:
1. hero - content: headline (benefit-driven, specific), subheadline, ctaText, ctaSecondary
2. problem - content: headline, description, painPoints string[]
3. solution - content: headline, description, benefits string[]
4. features - content: title, subtitle, items: Array of {title, description}
5. pricing - content: headline, subtitle, plans: Array of {name, price, period, description, features, highlighted}
6. faq - content: subtitle, items: Array of {question, answer}
7. cta - content: headline, subheadline, ctaText
COPYWRITING: Specific customer-focused copy. Use blueprint data. Font: Inter, borderRadius: 12px. Industry: ${industry}.
Return ONLY valid JSON with pages array, theme (primaryColor, secondaryColor), and components array.`;

    const raw = await this.callAPI(
      this.endpoint,
      this._apiKey,
      this._model,
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

  const entry = providerRegistry["entries"]?.get(providerId) as { model?: string } | undefined;
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

  logger.info(
    { availableProviders: availableCount, hasFreeLLM, context },
    "AI provider: starting fallback chain",
  );

  if (hasFreeLLM) {
    const provider = new FreeLLMProvider();
    logger.info({ provider: "freellm", model: "gpt-4o-mini", apiKeyExists: !!env.FREELLM_API_KEY }, "[AI] attempting provider");
    try {
      logger.info({ provider: "FreeLLMAPI", model: "gpt-4o-mini" }, "AI provider: attempting FreeLLMAPI");
      const { result } = await tryProvider("freellm", provider, action);
      logger.info({ provider: "FreeLLMAPI" }, "AI provider: FreeLLMAPI succeeded");
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
    const entry = providerRegistry.getNextAvailableProvider();
    if (!entry) break;

    attemptCount++;
    const provider = entry.createProvider();
    logger.info({ provider: entry.id, model: entry.model, apiKeyExists: !!entry.apiKey }, "[AI] attempting provider");
    try {
      logger.info({ provider: entry.provider, model: entry.model, id: entry.id, attempt: attemptCount, total: availableCount }, "AI provider: attempting");
      const { result } = await tryProvider(entry.id, provider, action);
      logger.info({ provider: entry.provider, model: entry.model }, "AI provider: succeeded");
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
        { provider: entry.provider, model: entry.model, id: entry.id, remainingProviders: remaining, error: message },
        "AI provider: failed — trying next",
      );
    }
  }

  const detail = errors.map((e) => `${e.provider} (${e.model}): [${e.statusCode}] ${e.error}`).join(" | ");
  const prefix = context ? `${context}: ` : "";
  const fullError = `${prefix}All AI providers failed (tried ${errors.length} providers): ${detail}`;
  logger.error({ errors: errors.map(e => ({ provider: e.provider, model: e.model, statusCode: e.statusCode, error: e.error })) }, fullError);
  throw new Error(fullError);
}

export async function generateBlueprintWithFallback(prompt: string): Promise<BlueprintResult> {
  const availableCount = providerRegistry.getEntryCount();
  const hasFreeLLM = !!env.FREELLM_API_KEY;
  logger.info(
    { promptLength: prompt.length, availableProviders: availableCount, hasFreeLLM },
    "generateBlueprintWithFallback: starting",
  );
  if (availableCount === 0 && !hasFreeLLM) {
    const error = "No AI provider configured. Set GOOGLE_API_KEY_1, GROQ_API_KEY, NIM_API_KEY_1, OPENROUTER_API_KEY, or FREELLM_API_KEY.";
    logger.error({ availableProviders: 0, hasFreeLLM: false }, error);
    throw new Error("No AI provider configured");
  }
  return withFailover((p) => p.generateBlueprint(prompt), "");
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
