import { DeploymentProvider, DeploymentFile, DeploymentResult, VerificationResult } from "./types.js";
import { env } from "../../lib/env.js";
import { logger } from "../../lib/logger.js";

const VERCEL_API = "https://api.vercel.com";

export class VercelProvider implements DeploymentProvider {
  name = "vercel";

  private get token(): string {
    if (!env.VERCEL_TOKEN) {
      throw new Error("VERCEL_TOKEN not configured");
    }
    return env.VERCEL_TOKEN;
  }

  async deploy(files: DeploymentFile[], siteName: string): Promise<DeploymentResult> {
    const sanitized = siteName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 48);
    const name = `startupos-${sanitized}`;

    const fileMap: Record<string, { file: string; data: string }> = {};
    for (const f of files) {
      fileMap[f.path] = {
        file: f.path,
        data: Buffer.from(f.content).toString("base64"),
      };
    }

    const body = {
      name,
      files: Object.values(fileMap),
      projectSettings: {
        framework: null,
        buildCommand: "",
        outputDirectory: ".",
        installCommand: "",
      },
      target: "production",
    };

    logger.info({ name, fileCount: files.length }, "Deploying to Vercel");

    const response = await fetch(`${VERCEL_API}/v13/deployments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, errorBody }, "Vercel deployment failed");
      throw new Error(`Vercel deployment failed (${response.status})`);
    }

    const data = await response.json() as {
      id: string;
      url: string;
      readyState: string;
    };

    const url = `https://${data.url}`;
    logger.info({ deploymentId: data.id, url, readyState: data.readyState }, "Vercel deployment created");

    return {
      url,
      provider: "vercel",
      deploymentId: data.id,
    };
  }

  async verify(url: string): Promise<VerificationResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeout);

      const body = await response.text();
      const hasContent = body.length > 100;
      const hasHtml = body.includes("<html") || body.includes("<!DOCTYPE");

      return {
        reachable: response.ok,
        statusCode: response.status,
        hasContent: hasContent && hasHtml,
      };
    } catch (error) {
      return {
        reachable: false,
        statusCode: 0,
        hasContent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
