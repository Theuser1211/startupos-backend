import { WebsiteResult } from "../../types/ai.js";
import { DeploymentFile } from "./types.js";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const window = new JSDOM("").window;
const purify = DOMPurify(window as any);

export function buildDeployFiles(website: WebsiteResult): DeploymentFile[] {
  const files: DeploymentFile[] = [];

  for (const page of website.pages) {
    const filePath = page.slug === "/" ? "index.html" : `${page.slug.replace(/^\//, "").replace(/\/$/, "")}/index.html`;
    files.push({ path: filePath, content: purify.sanitize(page.html) });
  }

  if (website.css) {
    files.push({ path: "styles.css", content: purify.sanitize(website.css) });
  }

  if (website.js) {
    files.push({ path: "app.js", content: purify.sanitize(website.js) });
  }

  return files;
}

export function buildFileManifest(files: DeploymentFile[]): string {
  return files.map((f) => `${f.path} (${f.content.length} bytes)`).join("\n");
}
