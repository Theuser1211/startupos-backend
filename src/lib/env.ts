import { z } from "zod";
import dotenv from "dotenv";
dotenv.config({ override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),

  PUBLIC_URL: z.string().url().optional(),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("7d"),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("startupos-deployments"),

  GOOGLE_API_KEY_1: z.string().optional(),
  GOOGLE_API_KEY_2: z.string().optional(),
  GOOGLE_API_KEY_3: z.string().optional(),

  GROQ_API_KEY: z.string().optional(),
  GROQ_API_KEY_1: z.string().optional(),
  GROQ_API_KEY_2: z.string().optional(),
  GROQ_API_KEY_3: z.string().optional(),

  NIM_API_KEY_1: z.string().optional(),
  NIM_API_KEY_2: z.string().optional(),

  FREELLM_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  VERCEL_TOKEN: z.string().optional(),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  AI_TIMEOUT_MS: z.coerce.number().default(60000),
  AI_FAILOVER_TOTAL_TIMEOUT_MS: z.coerce.number().default(60000),
  WEBSITE_AI_TIMEOUT_MS: z.coerce.number().default(90000),
  JOB_TIMEOUT_MS: z.coerce.number().default(600000),
  JOB_MONITOR_INTERVAL_MS: z.coerce.number().default(30000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
