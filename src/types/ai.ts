import type {
  BlueprintResult,
  WebsiteSpecResult,
  PageSpec,
  SectionSpec,
  ThemeSpec,
  ComponentSpec,
  PageHTMLResult,
  WebsiteResult,
} from "@startupos/shared";

export type {
  BlueprintResult,
  WebsiteSpecResult,
  PageSpec,
  SectionSpec,
  ThemeSpec,
  ComponentSpec,
  PageHTMLResult,
  WebsiteResult,
};

export interface AIProvider {
  name: string;
  generateBlueprint(prompt: string): Promise<BlueprintResult>;
  generateWebsiteSpec(blueprint: BlueprintResult): Promise<WebsiteSpecResult>;
  generateWebsitePage(
    blueprint: BlueprintResult,
    spec: WebsiteSpecResult,
    page: PageSpec,
  ): Promise<PageHTMLResult>;
}
