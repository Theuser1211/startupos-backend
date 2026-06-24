import {
  BlueprintResult,
  WebsiteSpecResult,
  WebsiteResult,
  PageHTMLResult,
} from "../../types/ai.js";
import { logger } from "../../lib/logger.js";
import { validateRenderedWebsite } from "./validate.js";
import { renderHomeFallback, renderGenericFallback } from "./fallbacks/home.js";
import { enrichWebsiteSpec } from "./spec-enricher.js";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const window = new JSDOM("").window;
const purify = DOMPurify(window as any);

export interface RenderResult {
  website: WebsiteResult;
  stats: {
    pagesGenerated: number;
    pagesFallback: number;
    total: number;
    providersUsed: string[];
    fallbackPages: string[];
    warnings: string[];
    enriched: boolean;
    sectionsPerPage: Record<string, string[]>;
  };
}

export async function renderWebsite(
  blueprint: BlueprintResult,
  spec: WebsiteSpecResult,
): Promise<RenderResult> {
  const warnings: string[] = [];

  const enrichedSpec = enrichWebsiteSpec(blueprint, spec);

  const sectionsPerPage: Record<string, string[]> = {};
  for (const page of enrichedSpec.pages) {
    sectionsPerPage[page.slug] = page.sections.map((s) => s.type);
  }

  const pages: PageHTMLResult[] = [];

  for (const page of enrichedSpec.pages) {
    logger.info({ page: page.name, slug: page.slug }, "Rendering page from spec");

    const result = renderPageFromSpec(blueprint, enrichedSpec, page);
    pages.push(result);
    logger.info({ page: page.name, slug: page.slug, htmlLength: result.html.length }, "Page rendered");
  }

  const result: WebsiteResult = {
    pages: pages.map((page) => ({
      ...page,
      html: purify.sanitize(page.html),
    })),
    css: "",
    js: "",
  };

  try {
    validateRenderedWebsite(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    warnings.push(`Website validation warning: ${message}`);
    logger.warn({ error: message }, "Website validation failed");
  }

  const enriched = JSON.stringify(enrichedSpec) !== JSON.stringify(spec);

  return {
    website: result,
    stats: {
      pagesGenerated: pages.length,
      pagesFallback: 0,
      total: pages.length,
      providersUsed: ["spec-template"],
      fallbackPages: [],
      warnings,
      enriched,
      sectionsPerPage,
    },
  };
}

function renderPageFromSpec(
  blueprint: BlueprintResult,
  spec: WebsiteSpecResult,
  page: import("../../types/ai.js").PageSpec,
): PageHTMLResult {
  if (page.slug === "/" || page.name.toLowerCase() === "home") {
    return renderHomeFallback(blueprint, spec.theme, page, spec);
  }
  return renderGenericFallback(blueprint, spec.theme, page, spec);
}
