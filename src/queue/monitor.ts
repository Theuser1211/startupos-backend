import { prisma } from "../db/client.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

let monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startJobMonitor(): void {
  const intervalMs = env.JOB_MONITOR_INTERVAL_MS;
  const timeoutMs = env.JOB_TIMEOUT_MS;

  logger.info({
    intervalMs,
    timeoutMs,
  }, "Starting job timeout monitor");

  monitorInterval = setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - timeoutMs);

      const result = await prisma.job.updateMany({
        where: {
          status: "PROCESSING",
          updatedAt: { lt: cutoff },
        },
        data: {
          status: "FAILED",
          error: `Job timed out after ${timeoutMs / 1000}s in PROCESSING state`,
        },
      });

      if (result.count > 0) {
        logger.warn({ count: result.count, timeoutMs }, "Job monitor: timed out stuck jobs");
      }
    } catch (error) {
      logger.error({ error }, "Job monitor: failed to check stuck jobs");
    }
  }, intervalMs);
}

export function stopJobMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info("Job monitor stopped");
  }
}