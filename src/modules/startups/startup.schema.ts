import { z } from "zod";

export const createStartupSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  logo: z.string().url().optional(),
  industry: z.string().max(100).optional(),
});

export const startupResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  logo: z.string().nullable(),
  industry: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type CreateStartupInput = z.infer<typeof createStartupSchema>;