import { Queue, Worker, QueueEvents } from "bullmq";
import Redis from "ioredis";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const QUEUE_NAME = "startupos-generations";
const REDIS_ENABLED = !!env.REDIS_URL;

if (!REDIS_ENABLED) {
  logger.info("Redis disabled - running without queue support");
}

function createRedisConnection() {
  const useTLS = env.REDIS_URL!.startsWith("rediss://");
  const redis = new Redis(env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    ...(useTLS ? { tls: {} } : {}),
  });
  redis.on("error", (err) => {
    logger.error({ err }, "Redis connection error");
  });
  redis.on("connect", () => {
    logger.info("Redis connected");
  });
  redis.on("ready", () => {
    logger.info("Redis ready");
  });
  return redis;
}

function ensureRedisEnabled(): void {
  if (!REDIS_ENABLED) {
    throw new Error("Queue system disabled: REDIS_URL not configured");
  }
}

let connection: ReturnType<typeof createRedisConnection> | null = null;
function getConnection() {
  ensureRedisEnabled();
  if (!connection) {
    connection = createRedisConnection();
  }
  return connection;
}

let queue: Queue | null = null;
let queueEvents: QueueEvents | null = null;

export function getQueue(): Queue {
  ensureRedisEnabled();
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
    queue.on("error", (err) => {
      logger.error({ err }, "Queue error");
    });
  }
  return queue;
}

export function getQueueEvents(): QueueEvents {
  ensureRedisEnabled();
  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, { connection: getConnection() });
    queueEvents.on("error", (err) => {
      logger.error({ err }, "QueueEvents error");
    });
  }
  return queueEvents;
}

export function createWorker(
  processor: (job: any) => Promise<void>,
): Worker {
  ensureRedisEnabled();
  const worker = new Worker(QUEUE_NAME, processor, {
    connection: getConnection(),
    concurrency: env.NODE_ENV === "production" ? 5 : 2,
    lockDuration: 30000,
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Worker job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, error: err?.message, stack: err?.stack }, "Worker job failed");
  });

  worker.on("error", (err) => {
    logger.error({ err }, "Worker error");
  });

  return worker;
}

export async function closeQueue(): Promise<void> {
  if (!REDIS_ENABLED) return;
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }
}