import { z } from "zod";

export const generateBlueprintSchema = z.object({
  startupId: z.string().uuid("Invalid startup ID"),
  prompt: z.string().min(10, "Prompt must be at least 10 characters").max(5000).optional(),
});

export type GenerateBlueprintInput = z.infer<typeof generateBlueprintSchema>;