import { JobType } from "@prisma/client";

export interface JobQueuePayload {
  jobId: string;
  startupId: string;
  userId: string;
  type: JobType;
  payload: Record<string, unknown>;
}