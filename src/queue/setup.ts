import { Queue, Worker, QueueEvents } from "bullmq";
import Redis from "ioredis";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const QUEUE_NAME = "startupos-generations";

function createRedisConnection() {
  if (env.REDIS_URL) {
    const useTLS = env.REDIS_URL.startsWith("rediss://");
    return new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      ...(useTLS ? { tls: {} } : {}),
    });
  }
  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    maxRetriesPerRequest: null,
  });
}

const connection = createRedisConnection();

let queue: Queue | null = null;
let queueEvents: QueueEvents | null = null;

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection,
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
  }
  return queue;
}

export function getQueueEvents(): QueueEvents {
  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, { connection });
  }
  return queueEvents;
}

export function createWorker(
  processor: (job: any) => Promise<void>,
): Worker {
  const worker = new Worker(QUEUE_NAME, processor, {
    connection,
    concurrency: env.NODE_ENV === "production" ? 5 : 2,
    lockDuration: 30000,
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Worker job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "Worker job failed");
  });

  return worker;
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }
}