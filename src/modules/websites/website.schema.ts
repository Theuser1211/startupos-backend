import { z } from "zod";

export const generateWebsiteSchema = z.object({
  startupId: z.string().uuid("Invalid startup ID"),
});

export type GenerateWebsiteInput = z.infer<typeof generateWebsiteSchema>;