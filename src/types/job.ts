import { JobStatus, JobType } from "@prisma/client";

export interface JobResponse {
  id: string;
  type: JobType;
  status: JobStatus;
  result?: unknown;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobQueuePayload {
  jobId: string;
  startupId: string;
  userId: string;
  type: JobType;
  payload: Record<string, unknown>;
}